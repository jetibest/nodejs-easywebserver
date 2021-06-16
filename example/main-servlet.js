require('../../nodejs-easywebserver').create(['forcedir', {
    name: 'custom-servlet',
    group: 'catch-default',
    middleware: function(req, res, next)
    {
        if(res.headersSent) return next();
        
        // build html page:
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        res.end('<!DOCTYPE html><html><body><h1>Hello world!</h1><p>The current time is: ' + new Date() + '.</p></body></html>');
        
		next();
    }
}, '404,log']).then(s => s.listen(parseInt(process.argv[2]))).catch(console.error);
