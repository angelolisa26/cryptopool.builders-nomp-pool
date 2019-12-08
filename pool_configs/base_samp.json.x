{
    "enabled": true,
    "coin": "coin_name.json",

    "address": "wallet",

    "rewardRecipients": {
        "pool_reward_fee_address1": 1.5,
        "pool_reward_fee_address2": 0.1
    },

    "paymentProcessing": {
        "enabled": true,
        "paymentInterval": 20,
        "minimumPayment": 70,
        "daemon": {
            "host": "127.0.0.1",
            "port": daemon_port,
            "user": "rpc_user",
            "password": "rpc_pass"
        }
    },

    "ports": {
        "3008": {
            "diff": 8
        },
        "3032": {
            "diff": 32,
            "varDiff": {
                "minDiff": 8,
                "maxDiff": 512,
                "targetTime": 15,
                "retargetTime": 90,
                "variancePercent": 30
            }
        },
        "rand_port_low": {
            "diff": 256
        }
    },
    
        "rand_port_var": {
            "diff": 32,
            "varDiff": {
            "minDiff": 8,
            "maxDiff": 1500,
            "targetTime": 15,
            "retargetTime": 90,
            "variancePercent": 30
	       }
    },
    
         "rand_port_high": {
		          "diff": 2000
			    }
    },

    "daemons": [
        {
            "host": "127.0.0.1",
            "port": daemon_port,
            "user": "rpc_user",
            "password": "rpc_pass"
        }
    ],

    "p2p": {
        "enabled": true,
        "host": "127.0.0.1",
        "port": 19333,
        "disableTransactions": true
    },

    "mposMode": {
        "enabled": false,
        "host": "127.0.0.1",
        "port": 3306,
        "user": "me",
        "password": "mypass",
        "database": "ltc",
        "checkPassword": true,
        "autoCreateWorker": false
    }

}
