exports.build = build;

const Defaults = {
	run: {
		name: 'dummy',
		user: 'www-data',
		group:  'www-data',
		paddleSock: '/run/paddle.sock',
		updateInterval: 5000
	},
	http: {
		path: '/run/dummy.sock'
	}
}

function build () {
	let baked = Object.assign({
		flags: {}
	}, Defaults);
	
	if (typeof baked.http.host === 'string' && 
	    typeof baked.http.port === 'number')
		baked.flags.is_inet = true;
	else if (typeof baked.http.path === 'string')
		baked.flags.is_sock = true;
	else
		throw 'Check Config.http.[host,port || path] for bind address';

	return baked;
};
