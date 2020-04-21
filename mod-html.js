const path = require('path');
const send = require('send');

module.exports = function(options)
{
	const mod = this;
	const webdir = path.resolve(options.webdir || path.resolve(options.__dirname || __dirname, 'public_html'));
	
	this._path = options.path || '/';
	this.middleware = function(req, res, next)
	{
		if(res.headersSent) return next();
	
		if(req.method !== 'GET' && req.method !== 'HEAD') return next();
		
		var nextwrap = function()
		{
			if(!next) return;
			next();
			next = null;
		};
		var s = send(req, req.url.replace(/[?#].*$/gi, ''), {root: webdir});
		s.on('error', function(err)
		{
			res.statusCode = err.status || 500;
			nextwrap(); // if error, end is not called (wrap next-call to ensure)
		});
		s.on('end', nextwrap);
		s.pipe(res);
	};
	this.group = 'catch-all';
	
	console.log('mod-html initialized matching path: ' + this._path + ', for directory: ' + webdir);
};
