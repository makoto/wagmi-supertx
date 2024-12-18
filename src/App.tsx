import { useEffect, useState } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { 
  createMeeService,
  mapAddressToChain,
  buildMultichainAddressMapping,
  toMultichainNexusAccount,
  getUnifiedERC20Balance,
  buildAbstractUserOp,
  formatMeeSignature
} from '@biconomy/experimental-mee'
import { 
  privateKeyToAccount, generatePrivateKey
} from "viem/accounts";
import { baseSepolia, arbitrumSepolia,  } from "viem/chains"; 
import { createPublicClient, formatEther, formatUnits, http, parseUnits, encodeFunctionData } from 'viem'

const eoa = privateKeyToAccount(import.meta.env.VITE_PRIV_KEY);
console.log(eoa)
const meeService = createMeeService({
    meeNodeUrl: "https://mee-node.biconomy.io",
});

const erc20Abi = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }]
  }
] as const;

// base https://sepolia.basescan.org/token/0x036cbd53842c5426634e7929541ec2318f3dcf7e
// sepolia https://sepolia.etherscan.io/token/0x1c7d4b196cb0c7b01d743fbc6116a902379c7238
const mcUSDC = buildMultichainAddressMapping([
  mapAddressToChain(
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e", baseSepolia.id),
  mapAddressToChain(
    "0xf3c3351d6bd0098eeb33ca8f830faf2a141ea2e1", arbitrumSepolia.id),
]);

const baseClient = createPublicClient({
  chain: baseSepolia,
  transport: http()
})

const arbitrumClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http()
})

const getChainName = (chainId: number | undefined) => {
  if (!chainId) return 'Unknown Chain'
  
  const chains: Record<number, string> = {
    [baseSepolia.id]: 'Base Sepolia',
    [arbitrumSepolia.id]: 'Arbitrum Sepolia',
    // Add more chains as needed
  }
  
  return chains[chainId] || `Chain ID: ${chainId}`
}



function App() {
  const account = useAccount()
  const { connectors, connect, status, error } = useConnect()
  const { disconnect } = useDisconnect()
  const [baseAddress, setBaseAddress] = useState<string>('')
  const [arbitrumAddress, setArbitrumAddress] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [baseBalance, setBaseBalance] = useState<string>('0')
  const [arbitrumBalance, setArbitrumBalance] = useState<string>('0')
  const [isBalanceLoading, setIsBalanceLoading] = useState(false)
  const [usdcBalance, setUsdcBalance] = useState<string>('0')
  const [recipient, setRecipient] = useState<string>('')
  const [amount, setAmount] = useState<string>('')
  const [isTransferring, setIsTransferring] = useState(false)
  
  const fetchBalances = async (baseAddr: string, arbitrumAddr: string) => {
    setIsBalanceLoading(true)
    try {
      const [baseBalanceWei, arbitrumBalanceWei] = await Promise.all([
        baseClient.getBalance({ address: baseAddr as `0x${string}` }),
        arbitrumClient.getBalance({ address: arbitrumAddr as `0x${string}` })
      ])

      setBaseBalance(formatEther(baseBalanceWei))
      setArbitrumBalance(formatEther(arbitrumBalanceWei))
    } catch (err) {
      console.error('Error fetching balances:', err)
      setAddressError('Failed to fetch balances')
    } finally {
      setIsBalanceLoading(false)
    }
  }

  useEffect(() => {
    const initializeAddresses = async () => {
      try {
        const mcNexus = await toMultichainNexusAccount({
          chains: [baseSepolia, arbitrumSepolia],
          signer: eoa,
        });
        
        const baseAddr = mcNexus.deploymentOn(baseSepolia.id).address;
        const arbitrumAddr = mcNexus.deploymentOn(arbitrumSepolia.id).address;
        const _usdcBalance = await getUnifiedERC20Balance({
            multichainAccount: mcNexus,
            tokenMapping: mcUSDC,
        });
        console.log({baseAddr, arbitrumAddr, usdcBalance})
        setUsdcBalance(formatUnits(_usdcBalance.balance, 6))

        setBaseAddress(baseAddr);
        setArbitrumAddress(arbitrumAddr);

        await fetchBalances(baseAddr, arbitrumAddr);
      } catch (error) {
        console.error('Error initializing addresses:', error);
      }
    };

    initializeAddresses();
  }, []);

  const handleRefreshAddresses = async () => {
    setIsLoading(true);
    setAddressError(null);
    try {
      const mcNexus = await toMultichainNexusAccount({
        chains: [baseSepolia, arbitrumSepolia],
        signer: eoa,
      });
      
      const newBaseAddr = mcNexus.deploymentOn(baseSepolia.id).address;
      const newArbitrumAddr = mcNexus.deploymentOn(arbitrumSepolia.id).address;
      
      const _usdcBalance = await getUnifiedERC20Balance({
          multichainAccount: mcNexus,
          tokenMapping: mcUSDC,
      });
      setUsdcBalance(formatUnits(_usdcBalance.balance, 6))
      
      setBaseAddress(newBaseAddr);
      setArbitrumAddress(newArbitrumAddr);

      await fetchBalances(newBaseAddr, newArbitrumAddr);
    } catch (err) {
      setAddressError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTransfer = async () => {
    if (!recipient || !amount) {
      setAddressError('Please provide recipient address and amount')
      return
    }

    setIsTransferring(true)
    setAddressError(null)

    try {
      const mcNexus = await toMultichainNexusAccount({
        chains: [baseSepolia, arbitrumSepolia],
        signer: eoa,
      });

      const userOpArb = buildAbstractUserOp({
          calls: [{
              to: mcUSDC.on(arbitrumSepolia.id),
              gasLimit: 100000n,
              data: encodeFunctionData({
                  abi: erc20Abi,
                  functionName: 'transfer',
                  args: [
                      mcNexus.deploymentOn(arbitrumSepolia.id).address,  // your SCA address
                      parseUnits('0.3', 6)  // 0.3 USDC (6 decimals)
                  ]
              })
          }],
          chainId: arbitrumSepolia.id
      });
      
      // User Operation for Base Sepolia
      const userOpBase = buildAbstractUserOp({
          calls: [{
              to: mcUSDC.on(baseSepolia.id),
              gasLimit: 100000n,
              data: encodeFunctionData({
                  abi: erc20Abi,
                  functionName: 'transfer',
                  args: [
                      mcNexus.deploymentOn(baseSepolia.id).address,  // your SCA address
                      parseUnits('0.3', 6)  // 0.3 USDC (6 decimals)
                  ]
              })
          }],
          chainId: baseSepolia.id
      });

      const quote = await meeService.getQuote({
        account: mcNexus,
        supertransaction: {
            instructions: [userOpArb, userOpBase],
            feeToken: {
                chainId: baseSepolia.id,
                address: mcUSDC.on(baseSepolia.id)
                // chainId: arbitrumSepolia.id,
                // address: mcUSDC.on(arbitrumSepolia.id)
            }
        }
      });
      console.log({quote})
      // const hash = await meeService.execute({
      //   quote: quote,
      //   signature: formatMeeSignature({
      //       signedHash: await eoa.signMessage({
      //           message: { raw: quote.hash }
      //       }),
      //       executionMode: 'direct-to-mee'
      //   })
      // });
      // console.log({hash})

      // // Build the transfer operation
      // const transferOp = buildERC20TransferOp({
      //   tokenMapping: mcUSDC,
      //   to: recipient as `0x${string}`,
      //   amount: parseUnits(amount, 6), // USDC has 6 decimals
      // });

      // // Build the multichain operation
      // const multichainOp = buildMultichainOp({
      //   operations: [transferOp],
      // });

      // // Build the user operation
      // const userOp = await buildAbstractUserOp({
      //   multichainAccount: mcNexus,
      //   operation: multichainOp,
      // });

      // // Send the operation to MEE node
      // const response = await meeService.sendUserOp(userOp);
      // console.log('Transfer response:', response);

      // Refresh balances after transfer
      // const _usdcBalance = await getUnifiedERC20Balance({
      //   multichainAccount: mcNexus,
      //   tokenMapping: mcUSDC,
      // });
      // setUsdcBalance(formatUnits(_usdcBalance.balance, 6))

      // await fetchBalances(baseAddress, arbitrumAddress);
    } catch (err) {
      console.error('Transfer error:', err)
      setAddressError(err instanceof Error ? err.message : 'Transfer failed')
    } finally {
      setIsTransferring(false)
    }
  }

  return (
    <>
      <div>
        <h2>Account</h2>
        <div>
          status: {account.status}
          <br />
          Base Address: {baseAddress}
          <br />
          Base Balance: {isBalanceLoading ? 'Loading...' : `${baseBalance} ETH`}
          <br />
          Arbitrum Address: {arbitrumAddress}
          <br />
          Arbitrum Balance: {isBalanceLoading ? 'Loading...' : `${arbitrumBalance} ETH`}
          <br />
          Unified USDC Balance: {isLoading ? 'Loading...' : `${usdcBalance} USDC`}
          <br />
          Current Network: {getChainName(account.chainId)}
        </div>

        <button 
          onClick={handleRefreshAddresses}
          disabled={isLoading || isBalanceLoading}
        >
          {isLoading || isBalanceLoading ? 'Refreshing...' : 'Refresh Addresses & Balances'}
        </button>
        <button 
          onClick={() => fetchBalances(baseAddress, arbitrumAddress)}
          disabled={isBalanceLoading || !baseAddress || !arbitrumAddress}
        >
          {isBalanceLoading ? 'Refreshing Balances...' : 'Refresh Balances Only'}
        </button>
        {addressError && (
          <div style={{ color: 'red' }}>{addressError}</div>
        )}

        {account.status === 'connected' && (
          <button type="button" onClick={() => disconnect()}>
            Disconnect
          </button>
        )}
      </div>

      <div>
        <h2>Connect</h2>
        {connectors.map((connector) => (
          <button
            key={connector.uid}
            onClick={() => connect({ connector })}
            type="button"
          >
            {connector.name}
          </button>
        ))}
        <div>{status}</div>
        <div>{addressError?.message}</div>
      </div>

      <div style={{ marginTop: '20px' }}>
        <h3>Transfer USDC</h3>
        <div>
          <input
            type="text"
            placeholder="Recipient Address"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            style={{ width: '300px', marginBottom: '10px' }}
          />
        </div>
        <div>
          <input
            type="text"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ width: '300px', marginBottom: '10px' }}
          />
        </div>
        <button
          onClick={handleTransfer}
          disabled={isTransferring || !recipient || !amount}
        >
          {isTransferring ? 'Transferring...' : 'Transfer USDC'}
        </button>
      </div>
    </>
  )
}

export default App
