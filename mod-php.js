const path = require('path');
const fs = require('fs');
const child_process = require('child_process');
const net = require('net');
//const phpFpm = require('php-fpm');
const express = require('express');

const fastCgi = require('fastcgi-client')
const defaultOptions = {
  host: '127.0.0.1',
  port: 9000,
  documentRoot: path.dirname(require.main.filename || '.'),
  skipCheckServer: true
}
const CHAR_CODE_R = '\r'.charCodeAt(0);
const CHAR_CODE_N = '\n'.charCodeAt(0);
var parseHeader = function(header, res)
{
	// we may want to set the headers of res
	var statusCode = 200;
	var statusMessage = '';
	var responseHeaders = {};
	var headerlines = header.split(/\r?\n/gi);
	for(var i=0;i<headerlines.length;++i)
	{
		var ln = headerlines[i];
		var colon = ln.indexOf(':');
		if(colon > 0)
		{
			var key = ln.substring(0, colon).replace(/(^\s+)|(\s+$)/gi, '');
			var value = ln.substring(colon + 1).replace(/(^\s+)|(\s+$)/gi, '');
			if(key.toLowerCase() === 'status')
			{
				const match = value.match(/(\d+)\s+?(.*)?/g);
				statusCode = parseInt(match[1]);
				statusMessage = match[2] || '';
			}
			else if(key.toLowerCase() !== 'x-powered-by')
			{
				var arr = responseHeaders[key];
				if(!arr)
				{
					responseHeaders[key] = [value];
				}
				else
				{
					arr.push(value);
				}
			}
		}
	}
	res.writeHead(statusCode, statusMessage, responseHeaders);
};

// custom module php-fpm, because the original module does only support php short output
// but for big output it's inefficient, and next to that, it doesn't work for other content-types such as printing images from php
const phpFpm = function(userOptions = {}, customParams = {})
{
	const options = Object.assign({}, defaultOptions, userOptions);
	const fpm = new Promise((resolve, reject) => {
		const loader = fastCgi(options);
		loader.on('ready', () => resolve(loader));
		loader.on('error', reject);
	});
	
	return async function(req, res)
	{
		let params = Object.assign({}, customParams, {
			uri: req.url
		});
		
		if(!params.uri || !params.uri.startsWith('/'))
		{
			throw new Error('invalid uri');
		}
		
		if(params.uri.indexOf('?') !== -1)
		{
			params.document = params.uri.split('?')[0];
			params.query = params.uri
				.slice(params.document.length + 1)
				.replace(/\?/g, '&');
		}
		
		if(!params.script)
		{
			params.script = path.join(options.documentRoot, params.document || params.uri);
		}

		const headers = {
			REQUEST_METHOD: req.method,
			CONTENT_TYPE: req.headers['content-type'],
			CONTENT_LENGTH: req.headers['content-length'],
			CONTENT_DISPOSITION: req.headers['content-disposition'],
			DOCUMENT_ROOT: options.documentRoot,
			SCRIPT_FILENAME: params.script,
			SCRIPT_NAME: params.script.split('/').pop(),
			REQUEST_URI: params.outerUri || params.uri,
			DOCUMENT_URI: params.document || params.uri,
			QUERY_STRING: params.query,
			REQUEST_SCHEME: req.protocol,
			HTTPS: req.protocol === 'https' ? 'on' : undefined,
			REMOTE_ADDR: req.connection.remoteAddress,
			REMOTE_PORT: req.connection.remotePort,
			SERVER_NAME: req.connection.domain,
			HTTP_HOST: req.headers.host,
			HTTP_COOKIE: req.headers.cookie,
			SERVER_PROTOCOL: 'HTTP/1.1',
			GATEWAY_INTERFACE: 'CGI/1.1',
			SERVER_SOFTWARE: 'php-fpm for Node',
			REDIRECT_STATUS: 200
		};

		for (const header in headers)
		{
			if(typeof headers[header] === 'undefined')
			{
				delete headers[header];
			}
		}

		const php = await fpm;
		return new Promise(function(resolve, reject)
		{
			php.request(headers, function(err, request)
			{
				if(err)
				{
					return reject(err);
				}
				var errors = ''

				req.pipe(request.stdin)

				var headerProcessed = false;
				var header = '';
				// on-readable will be called multiple times (for big files like images), but only the first time we process the header
				request.stdout.on('readable', function()
				{
					var chunk;
					if(!headerProcessed)
					{
						while(true)
						{
							chunk = request.stdout.read(1);
							
							if(chunk === null)
							{
								return; // chunk is null, so return instead of break, wait until another readable event is given
							}
							else if(chunk[0] === CHAR_CODE_R)
							{
								chunk = request.stdout.read(1);
								if(chunk === null) break;
								if(chunk[0] !== CHAR_CODE_N)
								{
									header += chunk.toString('utf8');
									continue;
								}
								chunk = request.stdout.read(1);
								if(chunk === null) break;
								if(chunk[0] !== CHAR_CODE_R)
								{
									header += chunk.toString('utf8');
									continue;
								}
								chunk = request.stdout.read(1);
								if(chunk === null) break;
								if(chunk[0] !== CHAR_CODE_N)
								{
									header += chunk.toString('utf8');
									continue;
								}
								// end of header detected
								parseHeader(header, res);
								headerProcessed = true;
								break; // break so that we way continue to write the HTTP body in the next while loop
							}
							else
							{
								header += chunk.toString('utf8');
							}
						}
					}
					
					while((chunk = request.stdout.read()) !== null)
					{
						res.write(chunk);
					}
				});

				request.stderr.on('data', function(data)
				{
					errors += data.toString('utf8');
				});

				request.stdout.on('end', function()
				{
					if(errors)
					{
						return reject(new Error(errors));
					}
					// end the response
					res.end();
					// resolve the promise
					resolve();
				});
			});
		});
	};
};


const PHP_DIR = '.php/';
const generateConfig = function(options)
{
	options = options || {};
	const path = ((options.path || '').replace(/\/$/gi, '') + '/').replace(/^\/$/gi, '');
	const host = options.host || '127.0.0.1';
	return [
		'[global]',
		'pid = ' + path + PHP_DIR + 'php-fpm.pid',
		'error_log = ' + path + PHP_DIR + 'error.log',
		'daemonize = no',
		'[www]',
		'clear_env = no', // keep environment variables, otherwise set specifically with env[PATH] = '/usr/bin:..'
		'user = ' + (options.user || 'apache'),
		'group = ' + (options.group || options.user || 'apache'),
		// 'chroot = ' + path, -> chroot for php-fpm is broken
		'listen = ' + host + ':' + (options.port || '8081'),
		'listen.allowed_clients = ' + (options.whitelist || (host === '127.0.0.1' ? '127.0.0.1' : 'any')),
		'pm = dynamic',
		'pm.max_children = 50',
		'pm.start_servers = 5',
		'pm.min_spare_servers = 5',
		'pm.max_spare_servers = 35',
		'slowlog = ' + path + PHP_DIR + 'www-slow.log',
		'php_admin_value[error_log] = ' + path + PHP_DIR + 'www-error.log',
		'php_admin_flag[log_errors] = on',
		'php_value[session.save_handler] = files',
		'php_value[session.save_path] = ' + path + PHP_DIR + 'session'
	].join('\n');
};
const getPort = function(port = 9001)
{
	return new Promise(function(resolve, reject)
	{
		const server = net.createServer();
		return server
			.on('error', function(err)
			{
				if(err.code === 'EADDRINUSE')
				{
					server.listen(++port);
				}
				else
				{
					reject(err);
				}
			})
			.on('listening', function()
			{
				server.close(function()
				{
					resolve(port);
				});
			})
			.listen(port);
	});
};

module.exports = {
	create: async function(options)
	{
		options = options || {};
		const phpdir = path.resolve(__dirname, options.path || options.__dirname || __dirname);
		const webdir = path.resolve(phpdir, options.webdir || 'public_html');
		const chrootedWebdir = webdir;//webdir.indexOf(phpdir) === 0 ? webdir.substring(phpdir.length) : webdir;
		//if(chrootedWebdir === webdir)
		//{
		//	console.log('[mod-php.js] warning: webdir (' + webdir + ') is not within path (' + phpdir + '), chroot will fail.');
		//}
		const host = options.host || '127.0.0.1';
		const port = options.port || await getPort();
		
		await fs.promises.mkdir(path.resolve(phpdir, PHP_DIR)).catch(function(err)
		{
			if(err.code === 'EEXIST')
			{
				return;
			}
			throw err;
		});
	
		await fs.promises.mkdir(path.resolve(path.resolve(phpdir, PHP_DIR), 'session')).catch(function(err)
		{
			if(err.code === 'EEXIST')
			{
				return;
			}
			throw err;
		});
		
		// console.log('php-fpm using documentRoot: ' + webdir + ', phpdir: ' + phpdir + ', chrooted webdir: ' + webdir);
		const app = express.Router({strict: true});
		const phpHandler = phpFpm({
			documentRoot: chrootedWebdir,
			host: host,
			port: port
		});
		app.use(function(req, res, next)
		{
			if(/^[^?]*\.php($|[?])/gi.test(req.url))
			{
				// console.log('running mod-php for: ' + req.url + ', ' + req.path);
				phpHandler(req, res, next);
			}
			else
			{
				next();
			}
		});
		app.use('/', function(req, res, next)
		{
			fs.access(path.resolve(webdir, req.path.substring(1) + 'index.php'), fs.constants.R_OK, function(err)
			{
				if(err)
				{
					return next(); // index.php does not exist
				}
				const uri = req.url.replace(/^[^?]*[/]/gi, $0 => $0 + 'index.php');
				// Fix the req object, just send only the necessary properties
				// console.log('running mod-php for: ' + webdir + ' -> ' + uri);
				phpHandler({
					method: req.method,
					headers: req.headers,
					connection: req.connection,
					protocol: req.protocol,
					url: uri,
					pipe: function(dst)
					{
						req.pipe(dst);
					}
				}, res, next);
			});
		});
		
		const configFile = path.resolve(phpdir, PHP_DIR + 'php-fpm.conf');
		await fs.promises.writeFile(configFile, generateConfig({
			path: phpdir,
			host: host,
			port: port
		}));
		
		// ensure apache ownership for .php (so it can store sessions)
		child_process.exec('chown -R apache:apache ' + path.resolve(phpdir, PHP_DIR), function(err, stdout, stderr)
		{
			if(err)
			{
				throw err;
			}
		});
		
		// run php-fpm server
		// console.log('php-fpm webdir: ' + webdir);
		console.log('php-fpm listening on ' + host + ':' + port + ' using configuration file: ' + configFile);
		child_process.execFile(options.exec || '/usr/sbin/php-fpm', ['--fpm-config=' + configFile], function(err, stdout, stderr)
		{
			if(err)
			{
				console.error('Error starting php-fpm. PHP files will not be able to run.');
				console.log(err);
				return;
			}
			console.log('php-fpm finished');
		});
		
		return {middleware: app, group: 'catch-extension'};
	}
};
