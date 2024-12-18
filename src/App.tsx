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
import { baseSepolia, sepolia } from "viem/chains"; 
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
    "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238", sepolia.id),
]);

const baseClient = createPublicClient({
  chain: baseSepolia,
  transport: http()
})

const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http()
})

const getChainName = (chainId: number | undefined) => {
  if (!chainId) return 'Unknown Chain'
  
  const chains: Record<number, string> = {
    [baseSepolia.id]: 'Base Sepolia',
    [sepolia.id]: 'Sepolia',
    // Add more chains as needed
  }
  
  return chains[chainId] || `Chain ID: ${chainId}`
}



function App() {
  const account = useAccount()
  const { connectors, connect, status, error } = useConnect()
  const { disconnect } = useDisconnect()
  const [baseAddress, setBaseAddress] = useState<string>('')
  const [sepoliaAddress, setSepoliaAddress] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [baseBalance, setBaseBalance] = useState<string>('0')
  const [sepoliaBalance, setSepoliaBalance] = useState<string>('0')
  const [isBalanceLoading, setIsBalanceLoading] = useState(false)
  const [usdcBalance, setUsdcBalance] = useState<string>('0')
  const [recipient, setRecipient] = useState<string>('')
  const [amount, setAmount] = useState<string>('')
  const [isTransferring, setIsTransferring] = useState(false)
  const [baseUsdcBalance, setBaseUsdcBalance] = useState<string>('0')
  const [sepoliaUsdcBalance, setSepoliaUsdcBalance] = useState<string>('0')
  const [walletEthBalance, setWalletEthBalance] = useState<string>('0')
  const [walletBaseUsdcBalance, setWalletBaseUsdcBalance] = useState<string>('0')
  const [walletSepoliaUsdcBalance, setWalletSepoliaUsdcBalance] = useState<string>('0')
  
  const fetchBalances = async (baseAddr: string, sepoliaAddr: string) => {
    setIsBalanceLoading(true)
    try {
      const [baseBalanceWei, sepoliaBalanceWei] = await Promise.all([
        baseClient.getBalance({ address: baseAddr as `0x${string}` }),
        sepoliaClient.getBalance({ address: sepoliaAddr as `0x${string}` })
      ])

      setBaseBalance(formatEther(baseBalanceWei))
      setSepoliaBalance(formatEther(sepoliaBalanceWei))
    } catch (err) {
      console.error('Error fetching balances:', err)
      setAddressError('Failed to fetch balances')
    } finally {
      setIsBalanceLoading(false)
    }
  }

  const fetchUsdcBalances = async (baseAddr: string, sepoliaAddr: string) => {
    try {
      const baseBalance = await baseClient.readContract({
        address: mcUSDC.on(baseSepolia.id),
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [baseAddr]
      })

      const sepoliaBalance = await sepoliaClient.readContract({
        address: mcUSDC.on(sepolia.id),
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [sepoliaAddr]
      })

      setBaseUsdcBalance(formatUnits(baseBalance, 6))
      setSepoliaUsdcBalance(formatUnits(sepoliaBalance, 6))
    } catch (err) {
      console.error('Error fetching USDC balances:', err)
    }
  }

  const fetchWalletBalances = async (address: string) => {
    if (!address) return

    try {
      const ethBalance = await baseClient.getBalance({ address: address as `0x${string}` })
      setWalletEthBalance(formatEther(ethBalance))

      const baseUsdcBalance = await baseClient.readContract({
        address: mcUSDC.on(baseSepolia.id),
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address]
      })

      const sepoliaUsdcBalance = await sepoliaClient.readContract({
        address: mcUSDC.on(sepolia.id),
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address]
      })

      setWalletBaseUsdcBalance(formatUnits(baseUsdcBalance, 6))
      setWalletSepoliaUsdcBalance(formatUnits(sepoliaUsdcBalance, 6))
    } catch (err) {
      console.error('Error fetching wallet balances:', err)
    }
  }

  useEffect(() => {
    const initializeAddresses = async () => {
      try {
        const mcNexus = await toMultichainNexusAccount({
          chains: [baseSepolia, sepolia],
          signer: eoa,
        });
        
        const baseAddr = mcNexus.deploymentOn(baseSepolia.id).address;
        const sepoliaAddr = mcNexus.deploymentOn(sepolia.id).address;
        const _usdcBalance = await getUnifiedERC20Balance({
            multichainAccount: mcNexus,
            tokenMapping: mcUSDC,
        });
        console.log({baseAddr, sepoliaAddr, usdcBalance})
        setUsdcBalance(formatUnits(_usdcBalance.balance, 6))

        setBaseAddress(baseAddr);
        setSepoliaAddress(sepoliaAddr);

        await fetchBalances(baseAddr, sepoliaAddr);
        await fetchUsdcBalances(baseAddr, sepoliaAddr);
      } catch (error) {
        console.error('Error initializing addresses:', error);
      }
    };

    initializeAddresses();
  }, []);

  useEffect(() => {
    if (account.address) {
      fetchWalletBalances(account.address)
    }
  }, [account.address, account.chainId])

  const handleRefreshAddresses = async () => {
    setIsLoading(true);
    setAddressError(null);
    try {
      const mcNexus = await toMultichainNexusAccount({
        chains: [baseSepolia, sepolia],
        signer: eoa,
      });
      
      const newBaseAddr = mcNexus.deploymentOn(baseSepolia.id).address;
      const newSepoliaAddr = mcNexus.deploymentOn(sepolia.id).address;
      
      const _usdcBalance = await getUnifiedERC20Balance({
          multichainAccount: mcNexus,
          tokenMapping: mcUSDC,
      });
      setUsdcBalance(formatUnits(_usdcBalance.balance, 6))
      
      setBaseAddress(newBaseAddr);
      setSepoliaAddress(newSepoliaAddr);

      await fetchBalances(newBaseAddr, newSepoliaAddr);
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
        chains: [baseSepolia, sepolia],
        signer: eoa,
      });

      const userOpSepolia = buildAbstractUserOp({
          calls: [{
              to: mcUSDC.on(sepolia.id),
              gasLimit: 100000n,
              data: encodeFunctionData({
                  abi: erc20Abi,
                  functionName: 'transfer',
                  args: [
                      mcNexus.deploymentOn(sepolia.id).address,
                      parseUnits('0.1', 6)
                  ]
              })
          }],
          chainId: sepolia.id
      });
      
      const userOpBase = buildAbstractUserOp({
          calls: [{
              to: mcUSDC.on(baseSepolia.id),
              gasLimit: 100000n,
              data: encodeFunctionData({
                  abi: erc20Abi,
                  functionName: 'transfer',
                  args: [
                      mcNexus.deploymentOn(baseSepolia.id).address,
                      parseUnits('0.1', 6)
                  ]
              })
          }],
          chainId: baseSepolia.id
      });

      const quote = await meeService.getQuote({
        account: mcNexus,
        supertransaction: {
            instructions: [userOpSepolia, userOpBase],
            feeToken: {
                chainId: baseSepolia.id,
                address: mcUSDC.on(baseSepolia.id)
            }
        }
      });
      console.log({quote})
      const hash = await meeService.execute({
        quote: quote,
        signature: formatMeeSignature({
            signedHash: await eoa.signMessage({
                message: { raw: quote.hash }
            }),
            executionMode: 'direct-to-mee'
        })
      });
     
      console.log('Supertransaction hash:', hash.hash);
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
          <h3>Wallet Info</h3>
          Address: {account.address || 'Not connected'}
          <br />
          ETH Balance: {walletEthBalance} ETH
          <br />
          Base USDC Balance: {walletBaseUsdcBalance} USDC
          <br />
          Sepolia USDC Balance: {walletSepoliaUsdcBalance} USDC
          <br />
          Status: {account.status}
          <br />
          Current Network: {getChainName(account.chainId)}
        </div>

        <h3>Smart Contract Account Info</h3>
        <div>
          Base Address: {baseAddress}
          <br />
          Base Balance: {isBalanceLoading ? 'Loading...' : `${baseBalance} ETH`}
          <br />
          Base USDC Balance: {`${baseUsdcBalance} USDC`}
          <br />
          <br />
          Sepolia Address: {sepoliaAddress}
          <br />
          Sepolia Balance: {isBalanceLoading ? 'Loading...' : `${sepoliaBalance} ETH`}
          <br />
          Sepolia USDC Balance: {`${sepoliaUsdcBalance} USDC`}
          <br />
          <br />
          Unified USDC Balance: {isLoading ? 'Loading...' : `${usdcBalance} USDC`}
        </div>

        <button 
          onClick={handleRefreshAddresses}
          disabled={isLoading || isBalanceLoading}
        >
          {isLoading || isBalanceLoading ? 'Refreshing...' : 'Refresh Addresses & Balances'}
        </button>
        <button 
          onClick={() => fetchBalances(baseAddress, sepoliaAddress)}
          disabled={isBalanceLoading || !baseAddress || !sepoliaAddress}
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
