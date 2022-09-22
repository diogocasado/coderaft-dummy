const OS = require('node:os');
const Fs = require('node:fs');
const asyncFs = Fs.promises;
const Path = require('node:path');
const Net = require('node:net');
const Http = require('node:http');
const Config = require('./config');

const promisify = require('node:util').promisify;
const execFile = promisify(require('node:child_process').execFile);

const Dummy = {
	config: Config.build(),
	stats: {
		pageloads: 0
	},
	run: {}
};

const Stats = [
	{
		id: 'pageloads',
		description: 'Page loads',
		value: () => Dummy.stats.pageloads
	}
]

async function setupUnixSocket () {

	try {
		let stats = await asyncFs.stat(Dummy.config.http.path);
		if (!stats.isSocket())
			throw "Error: Cannot use http socket at " + Dummy.config.http.path;
	
	} catch (error) {

		if (error.errno === -OS.constants.errno.ENOENT)
			return;

		throw error;
	}

	await asyncFs.unlink(Dummy.config.http.path);
}

async function chownUnixSocket () {
	const idu = await execFile('id', ['-u', Dummy.config.run.user]);
	const idg = await execFile('id', ['-g', Dummy.config.run.group]);

	const ueid = +idu.stdout;
	const geid = +idg.stdout;

	await asyncFs.chown(Dummy.config.http.path, ueid, geid);
}

async function startHttpServer () {
	
	if (Dummy.config.flags.is_sock)
		await setupUnixSocket();

	Dummy.server = Http.createServer(handleRequest);
	Dummy.server.on('error', handleError);
	Dummy.server.on('listening', handleListen);
	Dummy.server.listen(Dummy.config.http);

	if (Dummy.config.flags.is_sock)
		await chownUnixSocket();
}

async function setguidProcess () {

	process.setegid(Dummy.config.run.group);
	process.seteuid(Dummy.config.run.user);

	console.log('Running as ' +
			`${Dummy.config.run.user},${process.geteuid()}:` +
			`${Dummy.config.run.group},${process.getegid()}`);
}

function handleListen () {
	let bindStr = 'http://';
	if (Dummy.config.flags.is_inet)
		bindStr +=
			Dummy.config.http.host + ':' +
			Dummy.config.http.port;
	else if (Dummy.config.flags.is_sock)
		bindStr +=
			'unix:' + Dummy.config.http.path;
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
	Dummy.stats.pageloads++;
}

function sendStats () {

	const request = {
		serviceName: Dummy.config.run.name,
		stats: []
	};

	for (let stat of Stats) {
		request.stats.push({
			id: stat.id,
			description: stat.description,
			value: stat.value()
		});
	}

	const paddle = Net.createConnection(Dummy.config.run.paddleSock, () => {
		const message = JSON.stringify(request);
		console.log('Send Stats: ' + message);
		paddle.end(message);
	});
}

Promise.resolve({})
	.then(startHttpServer)
	.then(setguidProcess);

Dummy.run.statsInterval = setInterval(
	sendStats,
	Dummy.config.run.updateInterval);

