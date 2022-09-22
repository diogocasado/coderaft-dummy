const OS = require('node:os');
const Fs = require('node:fs');
const asyncFs = Fs.promises;
const Path = require('node:path');
const Http = require('node:http');
const Config = require('./config');

const promisify = require('node:util').promisify;
const execFile = promisify(require('node:child_process').execFile);

const dummy = {
	config: Config.build(),
	stats: {
		pageloads: 0
	}
};

const Stats = [
	{
		id: 'pageloads',
		description: 'Page loads',
		value: () => dummy.stats.pageloads
	}
]

async function setupUnixSocket () {

	try {
		let stats = await asyncFs.stat(dummy.config.http.path);
		if (!stats.isSocket())
			throw "Error: Cannot use http socket at " + dummy.config.http.path;
	
	} catch (error) {

		if (error.errno === -OS.constants.errno.ENOENT)
			return;

		throw error;
	}

	await asyncFs.unlink(dummy.config.http.path);
}

async function chownUnixSocket () {
	const idu = await execFile('id', ['-u', dummy.config.run.user]);
	const idg = await execFile('id', ['-g', dummy.config.run.group]);

	const ueid = +idu.stdout;
	const geid = +idg.stdout;

	await asyncFs.chown(dummy.config.http.path, ueid, geid);
}

async function startHttpServer () {
	
	if (dummy.config.flags.is_sock)
		await setupUnixSocket();

	dummy.server = Http.createServer(handleRequest);
	dummy.server.on('error', handleError);
	dummy.server.on('listening', handleListen);
	dummy.server.listen(dummy.config.http);

	if (dummy.config.flags.is_sock)
		await chownUnixSocket();
}

async function setguidProcess () {

	process.setegid(dummy.config.run.group);
	process.seteuid(dummy.config.run.user);

	console.log('Running as ' +
			`${dummy.config.run.user},${process.geteuid()}:` +
			`${dummy.config.run.group},${process.getegid()}`);
}

function handleListen () {
	let bindStr = 'http://';
	if (dummy.config.flags.is_inet)
		bindStr +=
			dummy.config.http.host + ':' +
			dummy.config.http.port;
	else if (dummy.config.flags.is_sock)
		bindStr +=
			'unix:' + dummy.config.http.path;
	console.log('Listening on: ' + bindStr);
}


function handleError (error) {
	console.log(error);
	process.exit(1);
}

function handleRequest  (request, response) {
    	response.setHeader('Content-Type', 'text/html');
	serveFileAsync('index.html', response);
	
	updateStats(request, response);
}

function serveFileAsync (path, response) {
    const readStream = Fs.createReadStream(path);

    return new Promise((finish, reject) => {
        readStream.pipe(response);
        readStream.on('end', () => {
            console.log("Read " + path);
            readStream.close();
            response.end();
            finish();
        });
        readStream.on('error', (error) => {
            console.log('Read 404 ' + error.code + ' ' + path);
            response.writeHead(404).end();
        });
    });
}

function updateStats (request, response) {
	dummy.stats.pageloads++;
}

function publishStats () {
	dummy.lastUpdate = Date.now();

	const paddle = {
		stats: []
	};

	for (let stat of Stats) {
		paddle.stats.push({
			description: stat.description,
			value: stat.value()
		});
	}

	const out = JSON.stringify(paddle);

	Fs.writeFileSync(dummy.config.run.paddle, out);
}

Promise.resolve({})
	.then(startHttpServer)
	.then(setguidProcess);

//setInterval(publishStats, dummy.config.updateInterval);

