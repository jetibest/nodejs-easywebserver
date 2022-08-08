module.exports = function(options)
{
	// by default hide access by returning 404 Not Found, but may also block access by returning 403 Forbidden
	var status = options.status || 404;
	// by default match any file starting with . or $ or _ or a directory of the name node_modules
	var matches = options.match || '.*,_*,$*,node_modules';
	if(typeof matches === 'string')
	{
		matches = matches.split(',');
	}
	if(!Array.isArray(matches))
	{
		console.error('mod-hide: Invalid usage, bad match type (' + (typeof matches) + ').');
	}
	matches = matches.map(function(m)
	{
		// escape for regex-safe string literal:
		m = m.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
		
		// enable use of basic wildcard matching:
		m = m.replace(/[\\][*]/g, '.*');
		m = m.replace(/[\\][?]/g, '.');
		
		return new RegExp('(^|/)' + m.replace() + '(/|$)', 'gi');
	});
	
	this.group = 'pre-route';
	this.middleware = (req, res, next) =>
	{
		if(res.headersSent || res.statusCode !== 200) return next();
		
		for(var match of matches)
		{
			match.lastIndex = 0; // reset regex
			
			if(match.test(req.path))
			{
				console.log('mod-hide: sent status ' + status + ' for url: ' + req.path);
				res.status(parseInt(status));
			}
		}
		next();
	};
	
	console.log('mod-hide initialized with match: ' + matches.join(', ') + '. Files and directories that are intended to stay hidden cannot be accessed by a path, the regex applies to the path (not the querystring).');
};
