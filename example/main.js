require('../').create('html,log,404').then(s => s.listen(parseInt(process.argv[2]))).catch(console.error);
