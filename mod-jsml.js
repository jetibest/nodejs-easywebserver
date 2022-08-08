const path = require('path');
const fs = require('fs');
const express = require('express');

function parse_imports(page_import)
{
    var imports = [];

    for(var i=0;i<page_import.length;++i)
    {
        var lib = page_import[i];
        var lib_name = path.normalize(lib)
			.replace(/[.][.][\/]/g, '__') // ../ --> __
			.replace(/[-\/]/g, '_') // - or / --> _
			.replace(/[^a-z0-9_]+/gi, ''); // any non alphanumeric or lowercase letter is removed
		
		imports.push('const ' + lib_name + ' = require(' + JSON.stringify(lib) + ');');
    }

    // make imports unique:
    imports = [...new Set(imports)];

    return imports;
}
async function resolves(fn)
{
    try
    {
        return await fn.apply(this, Array.from(arguments).slice(1)) || true;
    }
    catch(err)
    {
        return false;
    }
}
function ignore_error()
{
}
function throw_error(info)
{
    return function throw_error(err)
    {
        if(err && err.stack) err.stack += '    in ' + info;
        throw err;
    };
}
async function handle_jsml_file(context, request, response, input_file, root_path, jail_path)
{
    var absolute_file = path.resolve(root_path, input_file);
    var jsml_file = await fs.promises.realpath(absolute_file).catch(ignore_error);
    
    // check if req_file exists and is within root-jail (no ../../), although for dynamic includes, we don't really have a jail
    // JSML could not catch this path, but that doesn't mean another middleware can't turn that path into something that exists, therefore return null, don't throw error
    if(!jsml_file)
    {
        // the file does not exist, this could be a virtual url
        // that means one of the directories must exist as a jsml-file
        // for instance, the virtual directory /some/virt/virtual-file.html
        // is coded as: /some/virt.jsml
        // but only if /some/virt/ does not exist as a directory (to avoid conflicts)
        
        var dir = input_file;
        var maxcnt = 1024; // near-infinite loop
        while(--maxcnt)
        {
            var test_dir = path.dirname(dir);
            if(test_dir === dir)
            {
                // parent path is equal to previous path, meaning we reached the root path (/)
                break;
            }
            // we don't need to have permissions to read the directory contents to be able to consider this directory as a collision for any jsml-file of the same name
            if(await resolves(fs.promises.access, path.resolve(root_path, dir)))
            {
                // collision exists with directory, so all parent path entries also exist (since we're going backwards)
                // this means a JSML-file cannot catch this path anymore
                break;
            }
            var test_file = path.resolve(root_path, path.join(test_dir, path.basename(dir)) + '.jsml');
            
            // test if a .jsml-file exists of this directory given by the path, and we must be able to read the JSML-file
            if(await resolves(fs.promises.access, test_file, fs.constants.R_OK))
            {
                // matching .jsml-file found
                jsml_file = test_file;
                break;
            }
            
            // continue to the next parent directory
            dir = test_dir;
        }
        
        if(maxcnt === 0)
        {
            throw new Error('Infinite loop detected in path traversal for request, directory depth limit reached (1024) (' + input_file + ').');
        }
        
        if(!jsml_file)
        {
            return null;
        }
    }
    
    // check if jsml path is a file
    var jsml_stat = await fs.promises.stat(jsml_file).catch(throw_error(jsml_file));
    if(jsml_stat.isDirectory())
    {
        // try /index.jsml on directory
        jsml_file = path.resolve(jsml_file, 'index.jsml');
        
        jsml_stat = await fs.promises.stat(jsml_file).catch(ignore_error);
        
        if(!jsml_stat)
        {
            // index.jsml does not exist
            return null;
        }
    }
    if(!jsml_stat.isFile()) // check latest version of jsml_stat
    {
        // not a file, cannot be parsed
        return null;
    }
    
    // check if file has .jsml extension
    if(!jsml_file.endsWith('.jsml'))
    {
        // not a JSML-file, cannot be parsed
        return null;
    }
    
    // check if file has .jsml.js extension, ensure it cannot be delivered
    if(jsml_file.endsWith('.jsml.js'))
    {
        if(!response.headersSent)
        {
            response.status(403);
        }
        return null;
    }
    
    // if jail_path is given, the real path of input_file must be a prefix of the real path of jail_path
    if(jail_path)
    {
        var real_jail_path = await fs.promises.realpath(jail_path).catch(throw_error(jsml_file));
        if(!jsml_file.startsWith(real_jail_path))
        {
            throw new Error('Jailbreak: JSML-file (' + jsml_file + ') is not within its given jail path (' + real_jail_path + ').');
        }
    }
    
    // add .js extension for it being a javascript file, and prefix with . to make it hidden (and also must be inaccessible by the public webserver -> serverside code must not be seen from the outside)
    var js_file = jsml_file.replace(/[^\/]*$/, filename => '.' + filename + '.js');
    
    // check if we need to parse it (last modified date of jsml > last modified date of .jsml.js, or .jsml.js does not exist at all yet)
    var js_stat = await fs.promises.stat(js_file).catch(ignore_error);
    if(!js_stat || !js_stat.isFile() || js_stat.mtimeMs < jsml_stat.mtimeMs)
    {
        await fs.promises.writeFile(js_file, await jsml.parse(jsml_file)).catch(throw_error(js_file));
        
        // clear require cache, to reload file again
        delete require.cache[require.resolve(js_file)];
    }
    
    // require .jsml.js (or report any require-errors)
    var js_page = require(js_file);
    
    if(!js_page || typeof js_page.render !== 'function')
    {
        throw new Error('Compiled JSML-page is invalid (no render-function in: ' + js_file + ').');
    }
    
    context.__jsml_file = jsml_file;
    context.__jsml_stat = jsml_stat;
    context.__js_file = js_file;
    context.__js_stat = js_stat;
    
    return await js_page.render.call(context, request, response).catch(throw_error(jsml_file));
}

const jsml = {
    // throws exception if file does not exist, or returns the (produced) file content
    include: async function(options, request, response)
    {
        if(typeof options === 'string')
        {
            options = {file: options};
        }
        if(!options || !options.file || typeof options.file !== 'string')
        {
            throw new Error('Invalid usage for include (' + options + ').');
        }
        
        var result = await handle_jsml_file(this, request, response, options.file, path.dirname(this.__jsml_file), this.root.path);
        
        if(result === null)
        {
            result = await fs.promises.readFile(options.file).catch(throw_error(options.file));
        }
        
        return result;
    },
    // parses a given jsml file, and returns generated javascript code as a string
    parse: async function(jsml_file)
    {
        var data = ((await fs.promises.readFile(jsml_file).catch(function(){})) || '') +'';

        var js_code_static = [];
        var js_code = [];

        // these may be overriden by <% @ page key=value %>.. or if array, added to
        var page = {
            'import': []
        };
        // 'special' must be refactored to 'static' or 'declaration'
        var special_regex = new RegExp(
            '([^=\\s_]+?[^=\\s]*?)' + // match key (should not be quoted, may not contain white spaces, nor may it start with underscores)
            '\\s*?[= ]\\s*' + // match equals sign (between key and value)
            '(' +
              '"([^"\\\\]*(\\\\.[^"\\\\]*)*)"' +
              '|' +
              '\'([^\'\\\\]*(\\\\.[^\'\\\\]*)*)\'' +
              '|' +
              '([^\\s]*)' + // match double quoted, match single quoted, or simple non-quoted
            ')',
            'gms' // match global multiline
        );

        // todo: optimization, instead of pushing char by char, we may also keep track of indices, to grab a whole substring
        var buf = [];
        var state_html = 1;
        var state_jsml = 2;
        var state_javascript = 3;
        var state_javascript_print = 4;
        var state_special = 5;
        var state_comment = 6;
        var state_static = 7;
        var parser_callback = function(state, data)
        {
            if(state === state_html)
            {
                js_code.push('out.print(' + JSON.stringify(data) + ');');
            }
            else if(state === state_javascript)
            {
                js_code.push(data);
            }
            else if(state === state_javascript_print)
            {
                js_code.push('out.print(out.encodeHTML(' + data + '));');
            }
            else if(state === state_static)
            {
                js_code_static.push(data);
            }
            else if(state === state_special)
            {
                // if @include, then the rest of the data until %> is used for the expression
                if(/^\s*include\s+/gms.test(data))
                {
                    // this will dynamically load jsml (or generate if needed), and call its middleware on the request/response
                    // or, if not a jsml-file, will simply print the file to the `out` buffer

                    js_code.push('out.print(await context.root.jsml.include.call(context, ' + data.replace(/^\s*include\s+/gms, '') + ', request, response));');
                }
                else if(/^\s*forward\s+/gms.test(data))
                {
                    // internal forward to another path (best practice is to return here, but we cannot guarantee that, because it may be wrapped within another function, responsibility is with the jsml-developer)

                    js_code.push('request.url = ' + data.replace(/^\s*forward\s+/gms, '') + ';');
                    js_code.push('await new Promise(resolve => request.app.handle(request, response, resolve)).catch(out.throw);');
                }
                else
                {
                    // assume page as the default keyword
                    data = data.replace(/^\s*page\s+/gms, '');

                    // loop through all (key[= ]value)-matches
                    special_regex.lastIndex = 0;
                    var m;
                    while((m = special_regex.exec(data)) !== null)
                    {
                        var p_key = m[1];
                        var p_val = m[3] || m[5] || m[7]; // double-quoted, single-quoted, or value without quotes
                        if(Array.isArray(page[p_key]))
                        {
                            page[p_key].push(p_val);
                        }
                        else
                        {
                            page[p_key] = p_val;
                        }
                    }
                }
            }
        };

        var state = state_html;
        for(var i=0;i<data.length;++i)
        {
            var c = data[i];
            if(state === state_html)
            {
                if(c === '<' && i+1 < data.length && data[i+1] === '%' && !(i+2 < data.length && data[i+2] === '%')) // <%% is the escaped form of <%
                {
                    parser_callback(state, buf.join(''));
                    buf = [];

                    i += 1;
                    state = state_jsml;
                }
                else
                {
                    buf.push(c);

                    // new out.print statement every newline, to avoid very long lines, to keep the compiled code readable
                    if(c === '\n')
                    {
                        parser_callback(state, buf.join(''));
                        buf = [];
                    }
                }
            }
            else if(state === state_jsml)
            {
                if(c === '-' && i+1 < data.length && data[i+1] === '-')
                {
                    i += 1;
                    state = state_comment;
                }
                else if(c === '@')
                {
                    state = state_special;
                }
                else if(c === '!')
                {
                    state = state_static;
                }
                else if(c === ' ' || c === '\n')
                {
                    state = state_jsml; // ignore any simple white spaces
                }
                else if(c === '=')
                {
                    // still catch javascript, but wrap in out.print
                    state = state_javascript_print;
                }
                else
                {
                    state = state_javascript;
                    --i; // process this char again, it's part of state_javascript
                }
            }
            else if(state === state_javascript || state === state_javascript_print || state === state_static || state === state_special)
            {
                if(c === '%' && i+1 < data.length && data[i+1] === '>')
                {
                    parser_callback(state, buf.join(''));
                    buf = [];

                    i += 1;
                    state = state_html;
                }
                else
                {
                    buf.push(c);
                }
            }
            else if(state === state_comment)
            {
                if(c === '-' && i+3 < data.length && data[i+1] === '-' && data[i+2] === '%' && data[i+3] === '>')
                {
                    parser_callback(state, buf.join(''));
                    buf = [];

                    i += 3;
                    state = state_html;
                }
            }
        }
        // final call:
        parser_callback(state, buf.join(''));

        var imports = parse_imports(page['import']);

        var response_lines = [];
        if('contentType' in page)
        {
            response_lines.push('response.set("Content-Type", ' + JSON.stringify(page['contentType']) + ');');
        }
        if('statusCode' in page)
        {
            response_lines.push('response.status(' + page['statusCode'] + ');');
        }
        else if('status' in page) // alias of statusCode
        {
            response_lines.push('response.status(' + page['status'] + ');');
        }
        // parsing complete, produce actual js code output with wrapping:

        // any variable may be used except for any prefix starting with __jsml
        // special keywords: __jsml_file, __jsml, request, response, out, include
        return [
            'const __jsml_file = ' + JSON.stringify(jsml_file) + ';',
            imports.join('\n'),
            js_code_static.join('\n'),
            'module.exports = {',
            '  render: async function(request, response)',
            '  {',
            '    const out = {',
            '      data: [],',
            '      print: function print()',
            '      {',
            '        Array.from(arguments).forEach(c => out.data.push(c));',
            '      },',
            '      println: function println(c)',
            '      {',
            '        out.print(c, "\\n");',
            '      },',
            '      encodeHTML: function encodeHTML(str)',
            '      {',
            '        return (str + "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\'/g, "&#039;");',
            '      },',
            '      throw: function _throw(err)',
            '      {',
            '        if(err.stack) err.stack += "    in " + __jsml_file;',
            '        throw err;',
            '      }',
            '    };', // keep buffer, don't send yet, so that we can still abort any write with an internal redirect (=forward)
            '    const context = {',
            '      __jsml_file: __jsml_file,',
            '      parent: this,',
            '      root: this.root || this,',
            '      out: out,',
            '      request: request,',
            '      response: response',
            '    };',
            '    await (async () =>', // wrap so that we may use 'return;', and still return the written data so far
            '    {',
            (!response_lines.length ? '' : [
            '      if(!response.headersSent && response.statusCode === 200)',
            '      {',
            '        ' + response_lines.join('\n        '),
            '      }',
            ].join('\n')),
            '      ' + js_code.join('\n      '),
            '    }).call(context).catch(out.error);', // for easily listing all the available options during development, it contains all globals that are also reserved and may not be overwritten (const)
            '    return out.data;',
            '  }',
            '};'
        ].join('\n') + '\n';
    }
};

module.exports = function(options)
{
    const mod = this;
    const webdir = path.resolve(options.webdir || this.webdir || path.resolve(options.__dirname || __dirname, 'public_html'));
    const bodyparsers = options.bodyparsers || ['json', 'urlencoded'];
    
    this._path = options.path || '/';
    this.middleware = async function(req, res, next)
    {
        if(res.headersSent || res.statusCode !== 200) return next();
        
        // this root is passed on always as the root
        const root = {jsml: jsml, path: webdir, module: mod, express: express};
        
        // this context will be the top-most parent of all contexts, each jsml-file has its own context (pageContext)
        const context = {root: root};
        
        // parse body, so that req.body is an object of key/value parsed data (i.e. urlencoded or json or multipart etc)
        if(bodyparsers)
        {
            for(var i=0;i<bodyparsers.length;++i)
            {
                var parser = bodyparsers[i];
                var fn = typeof parser === 'function' ? parser : express[parser]();
                
                await new Promise(resolve => fn.call(context, req, res, resolve));
            }
        }
        
        
        try
        {
            // handle JSML-file (returns null if no JSML detected)
            var result = await handle_jsml_file(context, req, res, req.url.replace(/[?#].*$/g, '').replace(/^\//g, ''), webdir, webdir);
            
            // if null, then not a JSML-parseable file (nor index.jsml if directory)
            if(result === null) return next();
            
            // turn output into flat array
            var data = (Array.isArray(result) ? result : [result]).flat(Infinity);
            
            // write data to response
            for(var chunk of data)
            {
                if(!chunk) continue;    
                if(typeof chunk !== 'string' && !Buffer.isBuffer(chunk)) chunk = chunk + ''; // toString if not buffer nor string
                res.write(chunk);
            }
        }
        catch(err)
        {
            console.error(err);
            
            if(!res.headersSent && res.statusCode === 200)
            {
                // show custom error page, maybe this err must be passed on in req.locals
                res.status(500);
            }
        }
        
        next();
    };
    this.group = 'catch-extension';
    
    console.log('mod-jsml initialized matching path: ' + this._path + ', for directory: ' + webdir);
};
