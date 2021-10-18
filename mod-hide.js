module.exports = function(options)
{
	const match = options.match || /^[^#?]*(^|\/)[.$_]/gi; // by default match any file starting with . or $ or _
	if(typeof match === 'string')
	{
		match = new RegExp(match, 'gi');
	}
	
	this.group = 'pre-route';
	this.middleware = (req, res, next) =>
	{
		match.lastIndex = 0; // reset regex
		
		if(match.test(req.url))
		{
			console.log('mod-hide: sent 403 for url: ' + req.url);
			if(res) res.status(403);
		}
		next();
	};
	
	console.log('mod-hide initialized with match: ' + match + ', files and directories that are intended to stay hidden cannot be accessed by a path, the regex applies to the path and following querystring and/or hash.');
};
