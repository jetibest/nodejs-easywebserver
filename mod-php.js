const path = require('path');
const fs = require('fs');
const child_process = require('child_process');
const net = require('net');
const phpFpm = require('php-fpm');
const express = require('express');

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
