const path = require('path');
const fs = require('fs');

module.exports = function(options)
{
	// You may use this module to reroute the request to a given path when a certain match took place
	// The difference with mod-urlrewrite is that this function does an internal redirect back to the start
	var path = options.path || '/http-404.html';
	var code = options.code || 0;
	var match = typeof options.match === 'string' && new RegExp(options.match, 'gi') || options.match;
	
	this.group = 'error';
	this.middleware = (req, res, next) =>
	{
		if(res.headersSent) return next();
		
		if(code)
		{
			if(res.statusCode !== parseInt(code)) return next();
		}
		if(typeof match === 'function')
		{
			if(!match.call(this, this._options._easywebserver.getPath(req), req, res)) return next();
		}
		if(match)
		{
			match.lastIndex = 0; // reset global regex
			
			if(!match.test(this._options._easywebserver.getPath(req))) return next();
		}
		if(typeof path === 'function')
		{
			return path.call(this, req, res, next); 
		}
		
		this._options._easywebserver.reroute(path, req, res);
	};
	
	console.log('mod-reroute initialized matching ' + match + ' (code=' + (code || '*') + ') to path: ' + path);
};
