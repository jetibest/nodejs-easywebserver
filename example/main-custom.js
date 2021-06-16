function print_object(obj)
{
	var sb = [];
	for(var k in obj)
	{
		sb.push(k + ' = ' + obj[k]);
	}
	return sb.join('\n') + '\n';
}
function text_to_html(str)
{
	return ((str || '') + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

require('../../nodejs-easywebserver/').create({
	modules: {
		name: 'debug',
		group: 'pre-route',
		middleware: function(req, res, next)
		{
			if(res.headersSent) return next();
			
			res.write('<!DOCTYPE html><html><body>');
			res.write('<h1>NodeJS-EasyWebServer</h1>');
			res.write('<h2>this</h2><pre>' + text_to_html(print_object(this)) + '</pre>');
			res.write('<h2>this._easywebserver.listModuleChain()</h2><pre>' + text_to_html(this._easywebserver.listModuleChain()) + '</pre>');
			res.write('<h2>this._easywebserver.getPath()</h2><pre>' + text_to_html(this._easywebserver.getPath(req)) + '</pre>');
			res.write('<h2>this._easywebserver.replaceURLPath</h2><pre>' + text_to_html(this._easywebserver.replaceURLPath) + '</pre>');
			res.write('<h2>this._easywebserver.reroute</h2><pre>' + text_to_html(this._easywebserver.reroute) + '</pre>');
			res.write('<h2>this._easywebserver._MOD_GROUP_ORDER</h2><pre>' + text_to_html(print_object(this._easywebserver._MOD_GROUP_ORDER)) + '</pre>');
			res.write('</body></html>');
			res.end();
			
			next();
		}
	}
}).then(s => s.listen(parseInt(process.argv[2]))).catch(console.error);
