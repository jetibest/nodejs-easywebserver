const ws = require('ws');

module.exports = function(options)
{
	const mod = this;
	
    this._websocketHandler = options.onwebsocket || options.websocket; // mandatory option to supply this function
	this._path = options.path || '/';
    
    if(typeof this._websocketHandler !== 'function')
    {
        throw new Error('mod-websocket must have "onwebsocket"-function(websocket, request) option upon new websocket-connection through an HTTP upgrade request.');
    }
    
    this._wss = new ws.Server({noServer: true});
    
    this.onupgrade = async function(req, socket, head)
    {
        // check if the path-option matches
        var req_path_parts = this._options._easywebserver.getPath(req).split('/');
        var match_path_parts = this._path.split('/');
        if(req_path_parts.length < match_path_parts.length)
        {
            // match is longer than request
            return;
        }
        for(var i=1;i<match_path_parts.length;++i)
        {
            if(match_path_parts[i].length > 0 && match_path_parts[i] !== req_path_parts[i])
            {
                // match failed, but not for the last and empty trailing slash
                // so that /a/b/c/ matches /a/b/c/d/e/f/...
                return;
            }
        }
        
        mod._wss.handleUpgrade(req, socket, head, function(websocket)
        {
            mod._websocketHandler.call(mod, websocket, req);
        });
    };
	this.group = 'pre-process';
	
	console.log('mod-websocket initialized matching path: ' + this._path);
};
