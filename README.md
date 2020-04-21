# nodejs-easywebserver (UNDER DEVELOPMENT)

A portable easy-to-use webserver with a one-liner for Unix/Linux using only Node.js and Express.js.

Easywebserver is a wrapper around [Express.js](https://expressjs.com/) with no additional dependencies (unless the mods require it, e.g. `php-fpm` for `mod-php`), which is based on the default Node.js [`http.Server`](https://nodejs.org/api/http.html#http_class_http_server).
It allows you to run a portable flexible and configurable webserver with just one line of code.
Additional functionality comes with extra mods which default to a configuration that fits a specific use-case.

# Disclaimer
Understand that this software is under development, and is still potentially unstable.
Use at own risk.
Make sure to checkout the source code for your concerns.

# Installation
```bash
cd /srv && git clone https://github.com/jetibest/nodejs-easywebserver.git
```

# Run example from shell
```bash
cd /srv/nodejs-easywebserver && node example/main.js
```

# Example with systemd
**`/root/nodejs-mywebapp.service`**:
```
[Unit]
Description=My example webapp

[Service]
Type=simple
WorkingDirectory=/srv/mywebapp
ExecStart=/bin/bash -c 'cd /srv/mywebapp/ && node main.js'

[Install]
WantedBy=multi-user.target
```

**`/srv/mywebapp/main.js`**:
```js
require('/srv/nodejs-easywebserver').create('forcedir,php,html', s => s.listen(8081));
```

**`/srv/mywebapp/public_html/index.phhp`**:
```php
<?php
echo "Hello World!";
?>
```

```bash
systemctl enable /root/nodejs-mywebapp.service
systemctl start nodejs-mywebapp
```

# Mods

## [pre-route] mod-dirtofile
Match extension based on directory-based pathname. For instance, `/page/` may internally route to `/page.html`.

Options:
 - **`extensions`**: The extensions for which the existence of files are checked in the filesystem, defaults to `html,htm,php,asp,aspx,jsp,cgi` (order matters, matching left-to-right). It may be useful to set this option to reduce the list for performance reasons.
 
## [pre-route] mod-forcedir
Ensures a trailing slash in the pathname using a redirect (302). No trailing slash is applied if the path is a file, i.e. it contains a `.` which would indicate an extension. Note that this method assumes proper standardized filenaming conventions.

Note that when using a proxy (for instance for a virtual host setup which is highly recommended), the original path should be put in an HTTP header (see the `header` option).

Options:
 - **`header`**: Customize the name of the header in which the proxy passes the original pathname (which is allowed to be the complete URL), defaults to `x-forwarded-original-path`.

## [pre-route] mod-hide
Block access to a directories or files based on a regular expression. Note that it does show that the file is actively forbidden, and the existence of the file is therefore not hidden - since if this were needed, the files or directory should probably not be there in the first place.

Options:
 - **`match`**: Regular expression, if matches the URL (=`/pathname?querystring#hash`), blocks access. Defaults to `/^[^#?]*(^|\/)[.$_]/gi` which matches all files starting with `.`, `$`, or `_`.
 
## [pre-route] mod-urlrewrite
Generic regular expression-based URL rewriting for internal routing only (no redirects, meaning the rewriting is not visible for clients i.e. in the address bar).

Options:
 - **`match`**: Regular expression or function, only for matching the URL (=`/pathname?querystring#hash`), has no default. It is the first argument of the `String.replace()` function in Javascript. Mod will fail to initialize if match is not set.
 - **`path`**: String or function with the replacement (not necessarily restricted to the pathname as the querystring and hash are also included in matching), defaults to an empty string (meaning the matched part will be removed). It is the second argument of `String.replace()` function in Javascript.

## [pre-process] -- no mods yet --

## [catch-extension] mod-php
Enable delivery of PHP-files (`.php`) using `php-fpm`. This mod will run its own `php-fpm` daemon, so that it can also have its own configurable files, and portable log-files in the working directory's `.php/` path.

Options:
 - **`webdir`**: Path to the directory that contains the web-files, defaults to `public_html` (relative to the working directory, may also be an absolute path).
 - **`path`**: Pathname on which to mount the webdir in URL, defaults to `/` (`example.com/` will by default refer to `public_html`).
 - **`host`**: Hostname at which the `php-fpm` daemon should be listening, defaults to `127.0.0.1`.
 - **`port`**: Port at which the `php-fpm` daemon should be listening, defaults to automatically grabbing any available port in the dynamic port range.
 - **`phpPath`**: Custom path for the `.php/` config/log directory, defaults to `.php` (relative to the working directory, may also be an absolute path).

## [catch-default] -- no mods yet --

## [catch-all] mod-html
Enable delivery of static files such as `.html`, `.css`, `.js`, `.jpg`, etc. in the `public_html` directory.

Options:
 - **`webdir`**: Path to the directory that contains the web-files, defaults to `public_html` (relative to the working directory, may also be an absolute path).
 - **`path`**: Pathname on which to mount the webdir in URL, defaults to `/` (`example.com/` will by default refer to `public_html`).

## [error] mod-reroute
Reroute the request to a different path, given a match is found. This is an internal redirect, sending the Request and Response object back to square one (to the first middleware handler of the app). This is the final handler, that will try to deal with errors from previous mods, and typically gives a 404 Not Found message.

Options:
 - **`code`**: HTTP Status-code that has to match the code already set by the Response-object (`res.statusCode`), by default will match any code.
 - **`match`**: Regular expression or function that needs to match the pathname (thus excluding querystring and hash), by default will match any pathname.
 - **`path`**: The destination or target pathname (any querystring or hash will be preserved) at which the request should be rerouted, defaults to `/http-404.html`.

## [post-process] mod-log
Basic logging to stdout (stderr is reserved for fatal errors and the like). Special log if no headers were sent, that ignores any verbosity level or method filtering.

Options:
 - **`level`**: Log level that determines verbosity, possible values are: `error` (v), `warning` (vv), `access` (vvv). Defaults to `access`.
 - **`method`**: Filter on method, i.e. POST, GET, etc (may be space or comma separated). No default, so every method is logged.

# How to create new mod

This template is a good starting point:

```js
module.exports = function(options)
{
    this.group = 'catch-default'; // choose from: pre-route, pre-process, catch-extension, catch-default, catch-all, post-process, error
    this.middleware = (req, res, next) =>
    {
        if(res.headersSent) return next(); // check if response has been sent, typically only if mod is in group: 'catch-*' or 'error'
        
        // ... do something with req and res ...
        // ... **always call next** after you're done ...
        // ... this allows post-processing which may involve logging or error-handling ...
        
        // some useful properties:
        //  - this.getPath(req)
        //  - this.replaceURLPath(match, replacement, req)
        //  - this.reroute(path, req, res, next)
        
        res.end('Hello world!');
        
        next();
    };
    console.log('mod-template initialized saying what the mod does given the configured options in preferably a one-liner');
};
```
 


