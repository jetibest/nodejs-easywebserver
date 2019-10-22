# nodejs-easywebserver

Easy-to-use multifunctional webserver.

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
