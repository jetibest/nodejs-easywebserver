require('../../nodejs-easywebserver/').create([
	'forcedir,' + 
	'urlrewrite:match=/some/with/escaped/comma\\,here/path/.*:path=/some/other/,' +
	'php,' +
	'html#webdir=public_html',
	{
		group: 'error',
		middleware: function(req, res, next)
		{
			if(res.headersSent) return next();
			
			res.end('Page not found.');
			
			next();
		}
	},
	{
		name: 'log',
		options: {
			level: 'warning'
		}
	}
]).then(s => s.listen(parseInt(process.argv[2]))).catch(console.error);
