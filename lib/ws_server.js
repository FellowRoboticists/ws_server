var create = (function() {
  
  var fs = require('fs');

  var WebSocketServer = require('ws').Server; 

  var bs = require('nodestalker');

  var SysLogger = require('ain2');

  var logger = new SysLogger({tag: 'ws_server', facility: 'local4'});

  // The current set of WebSocket connections held by the server.
  // The contents of this collection will change as client 
  // connections are made and closed.
  var wsConnections = [];

  // The actual thing that will get exported from this module
  var module = {};

  //
  // Exported.
  //
  // Starts watching the beanstalk tube and forwarding
  // messages to any connected clients
  //
  module.watch_notification_tube = function(cfg) {
    var client = bs.Client();

    watchForNotifications();

    /**
     * Watches for notifications on the beanstalk 'notify'
     * tube and hands them off for processing.
     */
    function watchForNotifications() {
      client.watch(cfg.tube).

        onSuccess(function(data) {
          client.reserve().

            onSuccess(function(job) {
              logger.debug('received job: ' + job.data);

              // OK, this loops us around to call ourselves again. This is necessary
              // to pick up the next job in the tube. The use of process.nextTick
              // means that the call to watchForNotifications() is not called on the
              // stack (which eventually blow after a large number of iterations).
              // Instead, process.nextTick means it will get executed on the next
              // iteration of the node event loop. It's kind of like magic.
              process.nextTick(function() { watchForNotifications(); });

              // Process the job and delete it when done. This will act as an async
              // call because of the trailing callback function.
              processNotification(job, function() {
                client.deleteJob(job.id).
                  onSuccess(function(del_msg) { logger.debug("Delete job: " + del_msg) }).
                  onError(function(err) { logger.debug("Delete job (err):" + err) } );
              });
            }).

            onError(function(err) { logger.err("Error when trying to reserve a job on tube " + cfg.tube + ': ' + err); }).

            onEnd(function(err) { logger.debug("onEnd when trying to reserve a job on tube " + cfg.tube + ': ' + err); });
        }).

        onError(function(err) { logger.err('Error watching tube: ' + cfg.tube + ' ' + err); }).

        onEnd(function(err) { logger.debug('onEnd watching tube: ' + cfg.tube + ' ' + err); });
    }
    
    /**
     * An asynchronous function to process the notifications
     * received on the beanstalk 'notify' tube'.
     */
    function processNotification(job, callback) {
      var components = job.data.split("|");
      var message = { 
        type: components[0] === 'robot_registered' ? 'register' : 'unregister',
        data: { name: components[1] } };
      var json = JSON.stringify(message);

      // Loop through all the connections and send the message
      // to all of them.
      for (var i=0; i<wsConnections.length; i++) {
        wsConnections[i].send(json, function(err) {
          if (err) {
            logger.err("Error writing json to socket connection: " + err);
          }
        });
      }

      callback();
    }

  };

  //
  // Exported.
  //
  // Start the WebSocket server. Manages the list of connected clients
  // providing socket connections so that the beanstalk watcher can
  // forward along messages.
  //
  module.start_ws_server = function(cfg) {
    var httpServ = (cfg.ssl) ? require('https') : require('http');
    if (cfg.ssl) {
      app = httpServ.createServer({
          // Providing server with ssl key/cert
          key: fs.readFileSync(cfg.ssl_key),
          cert: fs.readFileSync(cfg.ssl_cert)
          }, processRequest).listen(cfg.port);
    } else {
      app = httpServ.createServer(processRequest).listen(cfg.port);
    }

    var wss = new WebSocketServer( { server: app } );

    // Deal with connections to the websocket server
    wss.on('connection', function(ws) {

      // Add the new connection to the list of connections
      wsConnections.push(ws);

      ws.on('close', function() {
        logger.info("The connection was closed");
        // Remove the connection from the list of connections
        var index = wsConnections.indexOf(ws);
        if (index >= 0) {
          wsConnections.splice(index, 1);
        } else {
          logger.warn("Connection was not found in the list of connections");
        }
      });

    })
  };

  // dummy request processing
  var processRequest = function( req, res ) {
    res.writeHead(200);
    res.end("All glory to WebSockets!\n");
  }

  return module;
}());

module.exports = create;
