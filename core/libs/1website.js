var fs = require('fs');
var path = require('path');

var async = require('async');
var watch = require('node-watch');
var redis = require('redis');

var dot = require('dot');
var express = require('express');
var bodyParser = require('body-parser');
var compress = require('compression');
var ampCors = require('amp-toolbox-cors');

var Stratum = require('cryptopool.builders-stratum-pool');
var util = require('cryptopool.builders-stratum-pool/lib/util.js');

var api = require('./api.js');

module.exports = function(logger) {
	dot.templateSettings.strip = false;

	var portalConfig = JSON.parse( process.env.portalConfig );
	var poolConfigs = JSON.parse( process.env.pools );

	var websiteConfig = portalConfig.website;

	var portalApi = new api( logger, portalConfig, poolConfigs );
	var portalStats = portalApi.stats;

	var logSystem = 'Website';

	var pageFiles = {
		'index.html': 'index',				// index page
		'home.html': '',				// home page
		'getting_started.html': 'getting_started',	// getting started page
		'dashboard.html': 'dashboard',                  // dashboard page
		'workers.html': 'workers',                      // all worker stats pages
		'payments.html': 'payments',                    // pool payments history
		'blocks.html': 'blocks',                        // pool blocks history
		'stats.html': 'stats',                          // pool stats pages
		'learn_more.html': 'learn_more',                // mining explained
		'miner_stats.html': 'miner_stats',              // miner stats page
		'faq.html': 'faq',                              // pool faq page
		'pool_stats.html': 'pool_stats'                 // pool page
	};

	var pageTemplates = {};

	var pageProcessed = {};
	var indexesProcessed = {};

	var keyScriptTemplate = '';
	var keyScriptProcessed = '';

	var processTemplates = function() {
		for ( var pageName in pageTemplates ) {
			if (pageName === 'index') {
				continue;
			}

			pageProcessed[pageName] = pageTemplates[pageName]( {
				canonical: '/' + ( pageName === '' ? '' : pageName + '.html' ),
				poolsConfigs: poolConfigs,
				stats: portalStats.stats,
				portalConfig: portalConfig
			} );
			indexesProcessed[pageName] = pageTemplates.index( {
				page: pageProcessed[pageName],
				selected: pageName,
				stats: portalStats.stats,
				poolConfigs: poolConfigs,
				portalConfig: portalConfig
			} );
		}
	};

	var readPageFiles = function(files) {
		async.each( files, function(fileName, callback) {
			var filePath = '../site/web/' + ( fileName === 'index.html' ? '' : 'pages/' ) + fileName;
			fs.readFile( filePath, 'utf8', function(err, data) {
				var pTemp = dot.template( data );
				pageTemplates[pageFiles[fileName]] = pTemp
				callback();
			} );
		}, function(err) {
			if (err) {
				console.log( 'error reading files for creating dot templates: '+ JSON.stringify( err ) );
				return;
			}
			processTemplates();
		} );
	};

	// if an html file was changed reload it
	/* requires node-watch 0.5.0 or newer */
	watch( ['../site/web/', '../site/web/'], function(evt, filename) {
		var basename;
		// support older versions of node-watch automatically
		if ( !filename && evt ) {
			basename = path.basename( evt );
		} else {
			basename = path.basename( filename );
		}

		if ( basename in pageFiles ) {
			readPageFiles( [ basename ] );
			logger.special( logSystem, 'Server', 'Reloaded file ' + basename );
		}
	} );

	portalStats.getGlobalStats( function() {
		readPageFiles( Object.keys( pageFiles ) );
	} );

	var buildUpdatedWebsite = function() {
		portalStats.getGlobalStats( function() {
			processTemplates();

			var statData = 'data: ' + JSON.stringify( portalStats.stats ) + '\n\n';
			for ( var uid in portalApi.liveStatConnections ) {
				var res = portalApi.liveStatConnections[uid];
				res.write(statData);
			}
		} );
	};

	setInterval( buildUpdatedWebsite, websiteConfig.stats.updateInterval * 1000 );

	var buildKeyScriptPage = function() {
		async.waterfall( [
			function(callback) {
				var client = redis.createClient( portalConfig.redis.port, portalConfig.redis.host );
				client.hgetall( 'coinVersionBytes', function(err, coinBytes) {
					if (err) {
						client.quit();
						return callback( 'Failed grabbing coin version bytes from redis ' + JSON.stringify( err ) );
					}
					callback( null, client, coinBytes || {} );
				} );
			},
			function (client, coinBytes, callback) {
				var enabledCoins = Object.keys( poolConfigs ).map( function(c) { return c.toLowerCase() } );
				var missingCoins = [];
				enabledCoins.forEach( function(c) {
					if ( !( c in coinBytes ) ) {
						missingCoins.push( c );
					}
				} );
				callback( null, client, coinBytes, missingCoins );
			},
			function(client, coinBytes, missingCoins, callback) {
				var coinsForRedis = {};
				async.each( missingCoins, function(c, cback) {
					var coinInfo = ( function() {
						for ( var pName in poolConfigs ) {
							if ( pName.toLowerCase() === c ) {
								return {
									daemon: poolConfigs[pName].paymentProcessing.daemon,
									address: poolConfigs[pName].address
								}
							}
						}
					} )();
					var daemon = new Stratum.daemon.interface( [coinInfo.daemon], function(severity, message) {
						logger[severity]( logSystem, c, message );
					} );
					daemon.cmd( 'dumpprivkey', [coinInfo.address], function(result) {
						if ( result[0].error ) {
							logger.error( logSystem, c, 'Could not dumpprivkey for ' + c + ' ' + JSON.stringify( result[0].error ) );
							cback();
							return;
						}

						var vBytePub = util.getVersionByte( coinInfo.address )[0];
						var vBytePriv = util.getVersionByte( result[0].response )[0];

						coinBytes[c] = vBytePub.toString() + ',' + vBytePriv.toString();
						coinsForRedis[c] = coinBytes[c];
						cback();
					} );
				}, function(err) {
					callback( null, client, coinBytes, coinsForRedis );
				} );
			},
			function(client, coinBytes, coinsForRedis, callback){
				if ( Object.keys( coinsForRedis ).length > 0 ) {
					client.hmset( 'coinVersionBytes', coinsForRedis, function(err) {
						if ( err ) {
							logger.error( logSystem, 'Init', 'Failed inserting coin byte version into redis ' + JSON.stringify( err ) );
						}
						client.quit();
					} );
				} else {
					client.quit();
				}
				callback( null, coinBytes );
			}
		], function(err, coinBytes) {
			if ( err ) {
				logger.error( logSystem, 'Init', err );
				return;
			}
			try{
				keyScriptTemplate = dot.template( fs.readFileSync( 'website/key.html', {
					encoding: 'utf8'
				} ) );
				keyScriptProcessed = keyScriptTemplate( {
					coins: coinBytes
				} );
			} catch(e) {
				logger.error( logSystem, 'Init', 'Failed to read key.html file' );
			}
		} );
	};
	buildKeyScriptPage();

	var getPage = function(pageId) {
		if ( pageId in pageProcessed ) {
			var requestedPage = pageProcessed[pageId];
			return requestedPage;
		}
	};

	var minerpage = function(req, res, next) {
		var address = req.params.address || null;
		if (address != null) {
			address = address.split(".")[0];
			portalStats.getBalanceByAddress(address, function() {
				processTemplates();
				res.header('Content-Type', 'text/html');
				res.end(indexesProcessed['miner-statistics']);
			});
		} else {
			next();
		}
	};

	var payout = function(req, res, next) {
		var address = req.params.address || null;
		if (address != null) {
			portalStats.getPayout(address, function(data) {
				res.write(data.toString());
				res.end();
			});
		} else {
			next();
		}
	};

	var shares = function(req, res, next) {
		portalStats.getCoins(function() {
			processTemplates();
			res.end(indexesProcessed['user_shares']);
		});
	};

	var usershares = function(req, res, next) {
		var coin = req.params.coin || null;
		if (coin != null) {
			portalStats.getCoinTotals(coin, null, function() {
				processTemplates();
				res.end(indexesProcessed['user_shares']);
			});
		} else {
			next();
		}
	};

	var route = function(req, res, next) {
		var pageId = req.params.page || '';
		if ( pageId in indexesProcessed ) {
			res.header( 'Content-Type', 'text/html' );
			res.end( indexesProcessed[pageId] );
		} else {
			next();
		}
	};

	var app = express();
	app.use(ampCors());
	app.use(bodyParser.json());

	app.get( '/donate/:coin/:address', function(req, res, next) {
		if ( req.params.coin && req.params.address ) {
			var protocol = null;
			switch( req.params.coin ) {
				case 'aur':
					protocol = 'auroracoin';
					break;
				case 'btc':
					protocol = 'bitcoin';
					break;
				case 'bch':
					protocol = 'bitcoincash';
					break;
				case 'boot':
					protocol = 'bitcoin'; // That coin sucks lol, it didn't even change the protocol!
					break;
				case 'bsv':
					protocol = 'bitcoinsv';
					break;
				case 'btcv':
					protocol = 'bitcoinv';
					break;
				case 'dash':
					protocol = 'dash';
					break;
				case 'dgb':
					protocol = 'digibyte';
					break;
				case 'doge':
					protocol = 'dogecoin';
					break;
				case 'ltc':
					protocol = 'litecoin';
					break;
				case 'lcc':
					protocol = 'litecoincash';
					break;
				case 'lcnt':
					protocol = 'lucent';
					break;
				case 'rvn':
					protocol = 'raven';
					break;
				case 'shnd':
					protocol = 'stronghands';
					break;
				case 'vtc':
					protocol = 'vertcoin';
					break;
				case 'vrsc':
					protocol = 'veruscoin';
					break;
				case 'xmr':
					protocol = 'monero';
					break;
				case 'xvg':
					protocol = 'verge';
					break;
				case 'zen':
					protocol = 'horizen';
					break;
				case 'zer':
					protocol = 'zero';
					break;
				default:
					break;
			}
			if ( protocol != null ) {
				res.header( 'X-Robots-Tag', 'none' );
				res.redirect( 301, protocol + ':' + req.params.address );
				return;
			}
		}
		next();
	} );
	app.get( '/get-page', function(req, res, next) {
		var requestedPage = getPage( req.query.id );
		if ( requestedPage ) {
			res.end( requestedPage );
			return;
		}
		next();
	} );

	app.get( '/key.html', function(req, res, next) {
		res.end( keyScriptProcessed );
	} );

	app.get( '/workers/:address', minerpage );

	app.get( '/:page', route );
	app.get( '/', route );

	app.get( '/api/:method', function(req, res, next) {
		portalApi.handleApiRequest( req, res, next );
	} );

	app.post('/api/admin/:method', function(req, res, next){
		if (portalConfig.website &&
			portalConfig.website.adminCenter &&
			portalConfig.website.adminCenter.enabled
		) {
			if ( portalConfig.website.adminCenter.password === req.body.password ) {
				portalApi.handleAdminApiRequest( req, res, next );
			} else {
				res.send( 401, JSON.stringify( {
					error: 'Incorrect Password'
				} ) );
			}
		} else {
			next();
		}
	} );

	express.static.mime.define( {
		'text/plain': ['pub']
	} );
	app.use( '/', express.static( 'website/static' ) );
	app.use( compress() );
	app.use( '/static', express.static( 'website/static' ) );

	app.use( function(err, req, res, next) {
		console.error( err.stack );
		res.send( 500, 'Something broke!' );
	} );

	try {
		app.listen( portalConfig.website.port, portalConfig.website.host, function () {
			logger.debug( logSystem, 'Server', 'Website started on ' + portalConfig.website.host + ':' + portalConfig.website.port );
		} );
	} catch(e) {
		logger.error( logSystem, 'Server', 'Could not start website on ' + portalConfig.website.host + ':' + portalConfig.website.port +  ' - its either in use or you do not have permission' );
	}
};
