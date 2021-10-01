const ws = require('ws');

module.exports = function(options)
{
	const mod = this;
	
    this._websocketHandler = options.onwebsocket || options.websocket; // mandatory option to supply this function
	this._path = options.path || '/';
    
    if(typeof this._websocketHandler !== 'function')
    {
        throw new Error('mod-websocket must have "onwebsocket"-function option, receiving args: request, websocket upon new websocket-connection through an HTTP upgrade request.');
    }
    
    this._wss = new ws.Server({noServer: true});
    
    this.onupgrade = async function(req, socket, head)
    {
        mod._wss.handleUpgrade(req, socket, head, function(websocket)
        {
            mod._websocketHandler.call(mod, req, websocket);
        });
    };
	this.group = 'pre-process';
	
	console.log('mod-websocket initialized matching path: ' + this._path);
};
