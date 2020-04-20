module.exports = {
	create: function(options)
	{
		var mod = this;
		
		mod.match = typeof options.match === 'string' && new RegExp(options.match, 'gi') || options.match;
		
		// match replacement (default: delete the matched part)
		mod.path = options.path || '';
		
		mod.group = 'pre-route';
		mod.middleware = function(req, res, next)
		{
			if(typeof mod.match === 'function')
			{
				if(!mod.match.call(mod, req.url, req, res)) return next();
			}
			
			mod.match.lastIndex = 0; // reset global index
			req.url = req.url.replace(mod.match, mod.path);
			
			next();
		};
		
		if(!mod.match) throw new Error('mod-urlrewrite failed to initialize, because it requires a match option (function or regex)');
		
		console.log('mod-urlrewrite initialized, rewrite url (path after base-servlet url) with regex');
		
		return mod;
	}
};

