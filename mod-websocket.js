const ws = require('ws');
const path = require('path');
const fs = require('fs');

function ignore_error()
{
}

module.exports = function(options)
{
    const mod = this;
    const webdir = path.resolve(options.webdir || this.webdir || path.resolve(options.__dirname || __dirname, 'public_html'));
	
    this._websocketHandler = options.onwebsocket || options.websocket; // mandatory option to supply this function
    this._path = options.path || '/';

    this._wss = new ws.Server({noServer: true});
    this.middleware = async function(req, res, next)
    {
        if(res &&(res.headersSent || res.statusCode !== 200)) return next();
        
        var req_path = req.url.replace(/[?#].*$/g, '').replace(/^\//g, '');
        var absolute_file = path.resolve(webdir, req_path);
        var jsws_file = await fs.promises.realpath(absolute_file).catch(ignore_error);
        
        if(!jsws_file) return next();
        
        var jsws_stat = await fs.promises.stat(jsws_file).catch(ignore_error);
        
        if(!jsws_stat) return next();
        
        if(jsws_stat.isDirectory())
        {
            // we only want to catch 403 if res exists, but in this case another index may be caught by this directory
            if(res) return next();
            
            // try /index.jsws on directory
            jsws_file = path.resolve(jsws_file, 'index.jsws');
            
            jsws_stat = await fs.promises.stat(jsws_file).catch(ignore_error);
            
            if(!jsws_stat) return next();
        }
        
        if(!jsws_stat.isFile()) return next();
        
        if(!jsws_file.endsWith('.jsws')) return next();
        
        if(!res)
        {
            return next(jsws_file);
        }
        
        // any jsws file may not be delivered normally, since this is a server-side code for catching websockets
        if(!res.headersSent)
        {
            res.status(403);
        }
        
        next();
    };
    this.onupgrade = async function(req, socket, head)
    {
	if(req.headers.upgrade !== 'websocket') return; // upgrade for another protocol, this is only for websocket
	
        var fn = [];
	
        if(this._websocketHandler) // it is also possible to use index.jsws files, with module.exports = {onwebsocket: function(ws){...}};
        {
            // check if the path-option matches
            var req_path_parts = this._options._easywebserver.getPath(req).split('/');
            var match_path_parts = this._path.split('/');
            if(req_path_parts.length >= match_path_parts.length)
            {
                // else: match is longer than request
                
                var matched = true;
                for(var i=1;i<match_path_parts.length;++i)
                {
                    if(match_path_parts[i].length > 0 && match_path_parts[i] !== req_path_parts[i])
                    {
                        // match failed, but not for the last and empty trailing slash
                        // so that /a/b/c/ matches /a/b/c/d/e/f/...
                        matched = false;
                        break;
                    }
                }
                
                if(matched)
                {
                    fn.push(function(websocket)
                    {
                        return mod._websocketHandler.call(mod, websocket, req);
                    });
                }
            }
        }
        
	// first let pre-route middleware handle the url processing:
	var routingModules = this._easywebserver._modules.filter(m => m && m.group === 'pre-route' && !m._disabled && typeof m.middleware === 'function');
	for(var i=0;i<routingModules.length;++i)
	{
		var m = routingModules[i];
		await new Promise(resolve => m.middleware.apply(m, [req, null, resolve]));
	}
	
        // match request path to jsws file
        var jsws_file = await new Promise(resolve => this.middleware(req, null, resolve));
        if(jsws_file)
        {
            fn.push(function(websocket)
            {
                return require(jsws_file).onwebsocket(websocket, req);
            });
        }
        
        if(!fn.length) return;
        
        // path for this websocket has been caught, so handle upgrade, and pass websocket to function
        await new Promise(resolve =>
        {
            mod._wss.handleUpgrade(req, socket, head, async function(websocket)
            {
                // mod._wss.emit('connection', websocket, req);
                for(var i=0;i<fn.length;++i)
                {
                    await fn[i](websocket, req);
                }
                resolve();
            });
        });
    };
    this.group = 'pre-process';
    
    console.log('mod-websocket initialized matching path: ' + this._path);
};
