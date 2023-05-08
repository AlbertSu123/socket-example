require('dotenv').config()
const { BigNumber, Contract, ethers, Wallet } = require("ethers");
const fetch = require('node-fetch');

const ERC20_ABI = require('erc-20-abi')

const api_key = 'c22d04ed-c3ec-4105-8fd9-fee1a8f15dc1'; // PUBLIC API KEY
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// Makes a GET request to Socket APIs for quote
async function getQuote(fromChainId, fromTokenAddress, toChainId, toTokenAddress, fromAmount, userAddress, uniqueRoutesPerBridge, sort) {
    const response = await fetch(`https://api.socket.tech/v2/quote?fromChainId=${fromChainId}&fromTokenAddress=${fromTokenAddress}&toChainId=${toChainId}&toTokenAddress=${toTokenAddress}&fromAmount=${fromAmount}&userAddress=${userAddress}&uniqueRoutesPerBridge=${uniqueRoutesPerBridge}&sort=${sort}`, {
        method: 'GET',
        headers: {
            'API-KEY': api_key,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    });

    const json = await response.json();
    return json;
}

// Starts bridging journey, creating a unique 'routeId' 
async function startRoute(startRouteBody) {

    try {
        const response = await fetch('https://api.socket.tech/v2/route/start', {
            method: 'POST',
            headers: {
                'API-KEY': api_key,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: startRouteBody
        });

        const json = await response.json();
        return json;
    }
    catch (error) {
        console.log("Error", error);
    }
}

// Sends confirmation of completion of transaction & gets status of whether to proceed with next transaction
async function prepareNextTx(activeRouteId, userTxIndex, txHash) {
    try {
        const response = await fetch(`https://api.socket.tech/v2/route/prepare?activeRouteId=${activeRouteId}&userTxIndex=${userTxIndex}&txHash=${txHash}`, {
            method: 'GET',
            headers: {
                'API-KEY': api_key,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        const json = await response.json();
        return json;
    }
    catch (error) {
        console.log("Error", error);
    }
}

// Calls route/build-next-tx and receives transaction data in response 
async function buildNextTx(activeRouteId) {
    try {
        const response = await fetch(`https://api.socket.tech/v2/route/build-next-tx?activeRouteId=${activeRouteId}`, {
            method: 'GET',
            headers: {
                'API-KEY': api_key,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        const json = await response.json();
        return json;
    }
    catch (error) {
        console.log("Error", error);
    }
}

// Helper Function to make approval
async function makeApprovalTx(approvalTokenAddress, allowanceTarget, minimumApprovalAmount, signer) {
    const ERC20Contract = new ethers.Contract(approvalTokenAddress, ERC20_ABI, signer);
    const gasEstimate = await ERC20Contract.estimateGas.approve(allowanceTarget, minimumApprovalAmount);
    const gasPrice = await signer.getGasPrice();

    console.log(ethers.utils.formatUnits(gasPrice, "gwei"));

    return ERC20Contract.approve(allowanceTarget, minimumApprovalAmount, {
        gasLimit: gasEstimate,
        gasPrice: gasPrice
    });
}




// Main function 
async function main() {

    // Polygon Provider
    const fromProvider = await ethers.getDefaultProvider('https://polygon.llamarpc.com');
    const fromSigner = new Wallet(PRIVATE_KEY, fromProvider);

    // Arbitrum Provider
    const toProvider = await ethers.getDefaultProvider('https://arb1.croswap.com/rpc');
    const toSigner = new Wallet(PRIVATE_KEY, toProvider);

    // Bridging Params fetched from users
    const fromChainId = 137;
    const toChainId = 42161;
    const fromAssetAddress = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";
    const toAssetAddress = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8";
    const userAddress = "0x01758beF794dADa872927d582496C69E95Be423b";
    const uniqueRoutesPerBridge = true; // Returns the best route for a given DEX / bridge combination
    const sort = "output"; // "output" | "gas" | "time"
    let activeRouteId; // These are retrieved and assinged from /route/start
    let userTxIndex; // These are retrieved and assinged from /route/start
    let txTarget;
    let txData;
    let value;

    // Quote for bridging 100 USDC on Polygon to UNI on Arbitrum
    // In multi transaction bridging, a swap is involved before bridging and after bridging.
    // Hence adding support for wider range of tokens
    // Please note, /route/start also works with transactions requiring a single tx.
    const quote = await getQuote(fromChainId,
        fromAssetAddress, toChainId,
        toAssetAddress, 1000,
        userAddress, uniqueRoutesPerBridge, sort
    );

    // console.log("Quote", quote);

    // Error only for this script.
    if (quote.result.routes[0] == undefined) throw new Error("No routes found");

    // Choosing first route from the returned route results 
    // route object retrieved from v2/quote in routes array
    const route = quote.result.routes[0];

    // console.log(route);

    // Body to be sent in the /route/start request
    let startRouteBody = {
        "fromChainId": fromChainId,
        "toChainId": toChainId,
        "fromAssetAddress": fromAssetAddress,
        "toAssetAddress": toAssetAddress,
        "includeFirstTxDetails": true,
        "route": route
    }

    // console.log("Starting Route", startRouteBody, JSON.stringify(startRouteBody));

    const routeStarted = await startRoute(JSON.stringify(startRouteBody));

    // Relevant data from response of /route/start
    activeRouteId = routeStarted.result.activeRouteId;
    userTxIndex = routeStarted.result.userTxIndex;
    activeRouteId = routeStarted.result.activeRouteId;
    userTxIndex = routeStarted.result.userTxIndex;
    txTarget = routeStarted.result.txTarget;
    txData = routeStarted.result.txData;
    value = routeStarted.result.value;

    // console.log(activeRouteId, userTxIndex);

    // Checks if user needs to give Socket contracts approval
    if (routeStarted.result.approvalData != null) {
        console.log('Approval is needed', routeStarted.result.approvalData);

        // Params for approval
        let approvalTokenAddress = routeStarted.result.approvalData.approvalTokenAddress;
        let allowanceTarget = routeStarted.result.approvalData.allowanceTarget;
        let minimumApprovalAmount = routeStarted.result.approvalData.minimumApprovalAmount;

        let tx = await makeApprovalTx(approvalTokenAddress, allowanceTarget, minimumApprovalAmount, fromSigner);
        console.log('tx', tx);
        await tx.wait().then(receipt => console.log('Approval Tx :', receipt.transactionHash))
            .catch(e => console.log(e));
    }
    else {
        console.log('Approval not needed');
    }

    // Main Socket Transaction (Swap + Bridge in one tx)
    const gasPrice = await fromSigner.getGasPrice();
    const sourceGasEstimate = await fromProvider.estimateGas({
        from: fromSigner.address,
        to: txTarget,
        value: value,
        data: txData,
        gasPrice: gasPrice
    });

    const tx = await fromSigner.sendTransaction({
        from: fromSigner.address,
        to: txTarget,
        data: txData,
        value: value,
        gasPrice: gasPrice,
        gasLimit: sourceGasEstimate
    });

    const receipt = await tx.wait();
    const txHash = receipt.transactionHash;
    console.log('Socket source Brige Tx :', receipt.transactionHash);

    let isInitiated = false;

    // Repeatedly pings /route/prepare with executed transaction hash
    // Once the bridging process is complete, if it returns 'completed', the setInterval exits
    // If another swap transaction is involved post bridging, the returned response result is 'ready'
    // In which case the above process is repeated on destination chain
    const status = setInterval(async () => {
        // Gets status of route journey 
        const status = await prepareNextTx(activeRouteId, userTxIndex, txHash);
        console.log("Current status :", status.result);

        // Exits setInterval if route is 'completed'
        if (status.result == 'completed') {
            console.log('Bridging transaction is complete');
            clearInterval(status);
        }

        // Executes post bridging transactions on destination
        else if (status.result == 'ready') {
            if (!isInitiated) {
                isInitiated = true;
                console.log('Proceeding with post-bridging transaction');

                const nextTx = await buildNextTx(activeRouteId);
                console.log(nextTx);

                // Updates relevant params
                userTxIndex = nextTx.result.userTxIndex;
                txTarget = nextTx.result.txTarget;
                txData = nextTx.result.txData;
                value = nextTx.result.value;

                // Checks if approval is needed 
                if (nextTx.result.approvalData != null) {
                    console.log('Approval is needed', nextTx.result.approvalData);

                    let approvalTokenAddress = nextTx.result.approvalData.approvalTokenAddress;
                    let allowanceTarget = nextTx.result.approvalData.allowanceTarget;
                    let minimumApprovalAmount = nextTx.result.approvalData.minimumApprovalAmount;

                    // Signer is initiated with provider of destination chain RPC
                    let tx = await makeApprovalTx(approvalTokenAddress, allowanceTarget, minimumApprovalAmount, toSigner);
                    console.log('tx', tx);
                    await tx.wait().then(receipt => console.log('Destination Approve Tx', receipt.transactionHash))
                        .catch(e => console.log(e));
                }
                else {
                    console.log('Approval not needed');
                }

                // Sends destination swap transaction
                const gasPrice = await toSigner.getGasPrice();
                const sourceGasEstimate = await toProvider.estimateGas({
                    from: toSigner.address,
                    to: txTarget,
                    data: txData,
                    value: value,
                    gasPrice: gasPrice,
                    value: ethers.utils.parseEther("0")
                });

                const tx = await toSigner.sendTransaction({
                    from: toSigner.address,
                    to: txTarget,
                    data: txData,
                    value: value,
                    gasPrice: gasPrice,
                    gasLimit: sourceGasEstimate
                });

                const receipt = await tx.wait();
                txHash = receipt.transactionHash;
                console.log('Destination Socket Tx', txHash)
            }
        }
    }, 5000)

}

main();