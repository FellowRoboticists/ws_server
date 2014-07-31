var create = (function() {
  
  var fs = require('fs');

  var WebSocketServer = require('ws').Server; 

  var bs = require('nodestalker');

  // The actual thing that will get exported from this module
  var module = {};

  module.start = function(cfg) {
    var httpServ = (cfg.ssl) ? require('https') : require('http');
    var client = bs.Client();
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

    /**
     * Watches for notifications on the beanstalk 'notify'
     * tube and hands them off for processing.
     */
    function watchForNotifications(ws, connectionState) {
      client.watch(cfg.tube).

        onSuccess(function(data) {
          client.reserve().
            onSuccess(function(job) {
              console.log('received job: ' + job.data);
              if (connectionState.connected) {

                process.nextTick(function() { 
                  watchForNotifications(ws, connectionState); 
                });

                processNotification(ws, job, connectionState, function() {
                  client.deleteJob(job.id).
                    onSuccess(function(del_msg) { console.log("Delete job: " + del_msg) }).
                    onError(function(err) { console.log("Delete job (err):" + err) } );
                });
              } else {
                console.log("Not connected to any client, deleting the job");
                client.deleteJob(job.id).
                  onSuccess(function(del_msg) { console.log("Delete job: " + del_msg) }).
                  onError(function(err) { console.log("Delete job (err):" + err) } );
              }
            }).

            onError(function(err) {
              console.log("Error when trying to reserve a job on tube " + cfg.tube + ': ' + err);
            }).

            onEnd(function(err) {
              console.log("onEnd when trying to reserve a job on tube " + cfg.tube + ': ' + err);
            });
        }).

        onError(function(err) {
          console.log('Error watching tube: ' + cfg.tube + ' ' + err);
        }).

        onEnd(function(err) {
          console.log('onEnd watching tube: ' + cfg.tube + ' ' + err);
        });
    }

    /**
     * An asynchronous function to process the notifications
     * received on the beanstalk 'notify' tube'.
     */
    function processNotification(ws, job, connectionState, callback) {
      var components = job.data.split("|");
      var message = { 
        type: components[0] === 'robot_registered' ? 'register' : 'unregister',
        data: { name: components[1] } };
      var json = JSON.stringify(message);
      ws.send(json, function(err) {
        if (err) {  
          console.log(err);
          connectionState.connected = false;
        }
      });

      callback();
    }

    // Deal with connections to the websocket server
    wss.on('connection', function(ws) {

      // A connection was established; do something
      var connectionState = new ConnectionState();

      watchForNotifications(ws, connectionState);

      ws.on('close', function() {
        console.log("The connection was closed");
        connectionState.connected = false;
      });

    })
  };

  // dummy request processing
  var processRequest = function( req, res ) {
    res.writeHead(200);
    res.end("All glory to WebSockets!\n");
  }

  //
  // Define an object to keep track of whether the
  // connection is still established
  // 
  function ConnectionState() {
    this.connected = true;
  }

  return module;
}());

module.exports = create;
