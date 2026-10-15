
import { useState, useEffect, useCallback } from 'react'
import {
  BrowserProvider,
  Contract,
  formatUnits,
  parseUnits,
  isAddress,
} from 'ethers'
import './App.css'

const ARC_CHAIN_ID = '0x13b2'
const ARC_CHAIN_NUMBER = 5042n
const ARC_RPC = 'https://rpc.mainnet.arc.io'
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000'
const EXPLORER = 'https://explorer.arc.io'
const HISTORY_KEY = 'quick-pay-ai-history'

const USDC_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
]

function readSavedHistory() {
  try {
    const saved = localStorage.getItem(HISTORY_KEY)
    const parsed = saved ? JSON.parse(saved) : []
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.error('Could not read payment history:', error)
    return []
  }
}

function App() {
  const [active, setActive] = useState('Overview')
  const [hideBalance, setHideBalance] = useState(false)
  const [notice, setNotice] = useState('')
  const [account, setAccount] = useState('')
  const [network, setNetwork] = useState('Not connected')
  const [balance, setBalance] = useState(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [balanceError, setBalanceError] = useState(false)

  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [txHash, setTxHash] = useState('')
  const [txStatus, setTxStatus] = useState('')
  const [history, setHistory] = useState(readSavedHistory)

  const navItems = [
    'Overview',
    'Payments',
    'Activity',
    'Assets',
    'AI Assistant',
  ]

  // Save payment history whenever it changes.
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
    } catch (error) {
      console.error('Could not save payment history:', error)
      setNotice('Could not save local history. Check browser storage.')
    }
  }, [history])

  const loadBalance = useCallback(async (address) => {
    if (!address || !window.ethereum) return

    setBalanceLoading(true)
    setBalanceError(false)

    try {
      const provider = new BrowserProvider(window.ethereum)
      const chainId = await provider.send('eth_chainId', [])

      if (chainId !== ARC_CHAIN_ID) {
        throw new Error('Switch your wallet to Arc Mainnet.')
      }

      const usdc = new Contract(USDC_ADDRESS, USDC_ABI, provider)
      const [rawBalance, decimals] = await Promise.all([
        usdc.balanceOf(address),
        usdc.decimals(),
      ])

      setBalance(formatUnits(rawBalance, Number(decimals)))
    } catch (error) {
      console.error('Balance error:', error)
      setBalance(null)
      setBalanceError(true)
    } finally {
      setBalanceLoading(false)
    }
  }, [])

  async function connectWallet() {
    try {
      setNotice('')

      if (!window.ethereum) {
        setNotice('Open Quick Pay AI in your wallet browser to connect.')
        return
      }

      await window.ethereum.request({ method: 'eth_requestAccounts' })

      let chainId = await window.ethereum.request({
        method: 'eth_chainId',
      })

      if (chainId !== ARC_CHAIN_ID) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: ARC_CHAIN_ID }],
          })
        } catch (error) {
          if (error.code !== 4902) throw error

          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: ARC_CHAIN_ID,
              chainName: 'Arc Mainnet',
              nativeCurrency: {
                name: 'USDC',
                symbol: 'USDC',
                decimals: 18,
              },
              rpcUrls: [ARC_RPC],
              blockExplorerUrls: [EXPLORER],
            }],
          })
        }

        chainId = await window.ethereum.request({
          method: 'eth_chainId',
        })
      }

      if (chainId !== ARC_CHAIN_ID) {
        throw new Error('Please switch to Arc Mainnet.')
      }

      const provider = new BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const address = await signer.getAddress()

      setAccount(address)
      setNetwork('Arc Mainnet')
      setNotice('Wallet connected successfully.')
      await loadBalance(address)
    } catch (error) {
      setNotice(
        error?.code === 4001
          ? 'Wallet connection was cancelled.'
          : error?.shortMessage || error?.message || 'Could not connect wallet.'
      )
    }
  }

  function disconnectWallet() {
    setAccount('')
    setBalance(null)
    setBalanceError(false)
    setNetwork('Not connected')
    setRecipient('')
    setAmount('')
    setTxHash('')
    setTxStatus('')
    setNotice('Wallet disconnected from this app.')
  }

  useEffect(() => {
    if (!window.ethereum?.on) return

    const handleAccountsChanged = (accounts) => {
      if (!accounts.length) {
        setAccount('')
        setBalance(null)
        setNetwork('Not connected')
        return
      }

      setAccount(accounts[0])
      loadBalance(accounts[0])
    }

    const handleChainChanged = (chainId) => {
      if (chainId !== ARC_CHAIN_ID) {
        setNetwork('Wrong network')
        setBalance(null)
        setBalanceError(true)
        setNotice('Please switch to Arc Mainnet.')
      } else {
        setNetwork('Arc Mainnet')
        setAccount((currentAccount) => {
          if (currentAccount) loadBalance(currentAccount)
          return currentAccount
        })
      }
    }

    window.ethereum.on('accountsChanged', handleAccountsChanged)
    window.ethereum.on('chainChanged', handleChainChanged)

    return () => {
      window.ethereum.removeListener?.('accountsChanged', handleAccountsChanged)
      window.ethereum.removeListener?.('chainChanged', handleChainChanged)
    }
  }, [loadBalance])

  async function sendUSDC(event) {
    event.preventDefault()
    setNotice('')
    setTxHash('')
    setTxStatus('')

    if (sending) return

    if (!account || !window.ethereum) {
      setNotice('Please connect your wallet first.')
      return
    }

    const to = recipient.trim()
    const amountText = amount.trim()

    if (!to) {
      setNotice('Please enter a recipient wallet address.')
      return
    }

    if (!isAddress(to)) {
      setNotice('Please enter a valid recipient wallet address.')
      return
    }

    if (to.toLowerCase() === account.toLowerCase()) {
      setNotice('Recipient address must be different from your own.')
      return
    }

    if (
      !amountText ||
      !Number.isFinite(Number(amountText)) ||
      Number(amountText) <= 0
    ) {
      setNotice('Please enter a valid USDC amount.')
      return
    }

    setSending(true)

    try {
      const provider = new BrowserProvider(window.ethereum)
      const networkInfo = await provider.getNetwork()

      if (networkInfo.chainId !== ARC_CHAIN_NUMBER) {
        throw new Error('Your wallet must be connected to Arc Mainnet.')
      }

      const signer = await provider.getSigner()
      const sender = await signer.getAddress()
      const usdc = new Contract(USDC_ADDRESS, USDC_ABI, signer)

      setTxStatus('Checking USDC balance...')

      const decimals = Number(await usdc.decimals())
      let value

      try {
        value = parseUnits(amountText, decimals)
      } catch {
        throw new Error('Please enter a valid USDC amount.')
      }

      if (value <= 0n) {
        throw new Error('The amount must be greater than zero.')
      }

      const currentBalance = await usdc.balanceOf(sender)

      if (value > currentBalance) {
        throw new Error('Insufficient USDC balance.')
      }

      const confirmed = window.confirm(
        `Review payment details\n\n` +
        `Amount: ${amountText} USDC\n` +
        `Recipient: ${to}\n` +
        `Network: Arc Mainnet\n\n` +
        `Mainnet transfers use real funds and may not be reversible.\n\n` +
        `Continue only if you checked the address and amount carefully.`
      )

      if (!confirmed) {
        setTxStatus('')
        setNotice('Payment cancelled. No transaction was sent.')
        return
      }

      setTxStatus('Waiting for wallet approval...')

      const tx = await usdc.transfer(to, value)

      setTxHash(tx.hash)
      setTxStatus('Transaction submitted. Waiting for confirmation...')

      const receipt = await tx.wait()

      if (!receipt || receipt.status !== 1) {
        throw new Error('The transaction failed on the blockchain.')
      }

      const payment = {
        hash: tx.hash,
        from: sender,
        to,
        amount: amountText,
        status: 'Confirmed',
        date: new Date().toISOString(),
        network: 'Arc Mainnet',
      }

      // Avoid adding the same transaction twice.
      setHistory((previous) => {
        const withoutDuplicate = previous.filter(
          (item) => item.hash?.toLowerCase() !== tx.hash.toLowerCase()
        )
        return [payment, ...withoutDuplicate]
      })

      setTxStatus('Transaction confirmed successfully.')
      setNotice('USDC payment confirmed on Arc Mainnet.')
      setRecipient('')
      setAmount('')

      await loadBalance(sender)
    } catch (error) {
      console.error('Send USDC error:', error)
      setTxStatus('')

      if (error?.code === 4001) {
        setNotice('Transaction rejected in your wallet.')
      } else {
        setNotice(
          error?.shortMessage ||
          error?.message ||
          'Payment failed. Please check your wallet and network.'
        )
      }
    } finally {
      setSending(false)
    }
  }

  function displayedBalance() {
    if (hideBalance) return '••••••'
    if (balanceLoading) return 'Loading...'
    if (balanceError) return 'Unavailable'
    if (balance === null) return '— — —'

    return Number(balance).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    })
  }

  function formatDate(date) {
    try {
      return new Date(date).toLocaleString()
    } catch {
      return date || 'Date unavailable'
    }
  }

  const fieldStyle = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '13px',
    borderRadius: '10px',
    border: '1px solid var(--border-color, #333)',
    background: 'var(--input-bg, #171923)',
    color: 'inherit',
    fontSize: '14px',
    marginTop: '8px',
  }

  function PaymentItem({ tx }) {
    return (
      <div
        key={tx.hash}
        style={{
          marginTop: 12,
          padding: '14px 0',
          borderBottom: '1px solid var(--border-color, #333)',
          overflowWrap: 'anywhere',
        }}
      >
        <strong>{tx.amount} USDC</strong>
        <p>{tx.status} · {formatDate(tx.date)}</p>
        <p>To: {tx.to}</p>
        <a href={`${EXPLORER}/tx/${tx.hash}`} target="_blank" rel="noreferrer">
          View transaction ↗
        </a>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">Q</div>
          <div>
            <h2>Quick Pay</h2>
            <span>AI WALLET</span>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>

        <nav className="navigation">
          {navItems.map((item) => (
            <button
              key={item}
              className={`nav-item ${active === item ? 'active' : ''}`}
              onClick={() => setActive(item)}
            >
              <span className="nav-dot">
                {item === 'Overview' ? '◈'
                  : item === 'Payments' ? '↗'
                  : item === 'Activity' ? '◷'
                  : item === 'Assets' ? '◇' : '✳'}
              </span>
              {item}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="network-status">
            <span className="status-dot" />
            <div>
              <strong>{network}</strong>
              <small>{account ? 'Wallet connected' : 'Wallet not connected'}</small>
            </div>
          </div>

          <div className="profile">
            <div className="avatar">Q</div>
            <div className="profile-info">
              <strong>Quick Pay User</strong>
              <small>
                {account
                  ? `${account.slice(0, 6)}...${account.slice(-4)}`
                  : 'Personal wallet'}
              </small>
            </div>
            <span>•••</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace / </span>
            <strong>{active}</strong>
          </div>

          <div className="topbar-actions">
            {account && (
              <button className="secondary-button" onClick={disconnectWallet}>
                Disconnect
              </button>
            )}

            <button className="connect-button" onClick={connectWallet}>
              {account
                ? `${account.slice(0, 6)}...${account.slice(-4)}`
                : 'Connect Wallet'}
              <span>{account ? '✓' : '↗'}</span>
            </button>
          </div>
        </header>

        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button
              className="notice-close"
              onClick={() => setNotice('')}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        )}

        {active === 'Overview' && (
          <>
            <section className="welcome-row">
              <div>
                <span className="eyebrow">YOUR FINANCIAL OVERVIEW</span>
                <h1>Welcome back.</h1>
                <p>One wallet. Smarter payments. More control.</p>
              </div>
              <div className="date-chip">◷ &nbsp; Arc Mainnet</div>
            </section>

            <section className="hero-card">
              <div className="hero-content">
                <span className="hero-tag">
                  <span className="status-dot" /> SMART WALLET EXPERIENCE
                </span>
                <h2>Money moves.<br />You stay in control.</h2>
                <p>
                  Manage your digital assets and explore a simpler way to pay
                  with Quick Pay AI.
                </p>
                <div className="hero-actions">
                  <button className="primary-button" onClick={connectWallet}>
                    {account ? 'Wallet Connected ✓' : 'Connect your wallet'}
                    {!account && <span>↗</span>}
                  </button>
                  <button className="text-button" onClick={() => setActive('Payments')}>
                    Send a payment →
                  </button>
                </div>
              </div>

              <div className="hero-art" aria-hidden="true">
                <div className="orb orb-one" />
                <div className="orb orb-two" />
                <div className="orbit orbit-one" />
                <div className="orbit orbit-two" />
                <div className="floating-card">
                  <span className="mini-label">QUICK PAY</span>
                  <div className="card-symbol">◈</div>
                  <div className="card-line" />
                  <div className="card-line short" />
                  <div className="card-footer">
                    <span>AI WALLET</span>
                    <span>•••• 2048</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="stats-grid">
              <article className="stat-card">
                <div className="stat-heading">
                  <span>Total balance</span>
                  <button
                    className="plain-icon"
                    onClick={() => setHideBalance(!hideBalance)}
                  >
                    {hideBalance ? '◉' : '◎'}
                  </button>
                </div>
                <h2>{displayedBalance()} <span>USDC</span></h2>
                <p className="muted-text">
                  {balanceError
                    ? 'Could not load balance'
                    : account
                      ? 'Arc Mainnet USDC'
                      : 'Connect wallet to view balance'}
                </p>
                {balanceError && account && (
                  <button
                    className="small-button"
                    onClick={() => loadBalance(account)}
                    disabled={balanceLoading}
                  >
                    Retry
                  </button>
                )}
              </article>

              <article className="stat-card">
                <div className="stat-heading">
                  <span>Total sent (saved history)</span>
                  <span className="stat-icon">↗</span>
                </div>
                <h2>
                  {history.reduce((sum, tx) => sum + Number(tx.amount || 0), 0).toFixed(2)}
                  {' '}<span>USDC</span>
                </h2>
                <p className="muted-text">Confirmed payments saved in this browser</p>
              </article>

              <article className="stat-card">
                <div className="stat-heading">
                  <span>Network</span>
                  <span className="stat-icon">◈</span>
                </div>
                <h2 className="network-title">{network}</h2>
                <p className="muted-text">
                  {account ? 'Wallet connected' : 'Ready to connect'}
                </p>
              </article>
            </section>

            <section className="content-grid">
              <article className="panel activity-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Recent activity</h3>
                    <p>Your saved payment history</p>
                  </div>
                  <button className="view-all" onClick={() => setActive('Activity')}>
                    View all →
                  </button>
                </div>

                <div className="empty-state">
                  <div className="empty-icon">◷</div>
                  <strong>
                    {history.length ? 'Recent payments' : 'No saved payments yet'}
                  </strong>
                  <p>Confirmed payments recorded by this app appear here.</p>
                  {history.slice(0, 3).map((tx) => (
                    <PaymentItem key={tx.hash} tx={tx} />
                  ))}
                </div>
              </article>

              <article className="panel quick-actions">
                <div className="panel-heading">
                  <div>
                    <h3>Quick actions</h3>
                    <p>Tools for your next move</p>
                  </div>
                </div>

                <button className="action-row" onClick={() => setActive('Payments')}>
                  <span className="action-icon send-icon">↗</span>
                  <span><strong>Send payment</strong><small>Transfer USDC</small></span>
                  <span className="action-arrow">→</span>
                </button>

                <button
                  className="action-row"
                  onClick={() => setNotice('Receive and QR tools will be added next.')}
                >
                  <span className="action-icon receive-icon">↙</span>
                  <span><strong>Receive</strong><small>Share your wallet</small></span>
                  <span className="action-arrow">→</span>
                </button>

                <button className="action-row" onClick={() => setActive('AI Assistant')}>
                  <span className="action-icon ai-icon">✳</span>
                  <span><strong>AI Assistant</strong><small>Explore smart tools</small></span>
                  <span className="action-arrow">→</span>
                </button>
              </article>
            </section>
          </>
        )}

        {active === 'Payments' && (
          <section className="panel" style={{ padding: 24, marginTop: 24 }}>
            <h2>Send USDC</h2>
            <p>Send USDC from your connected wallet on Arc Mainnet.</p>

            {!account && (
              <button className="primary-button" onClick={connectWallet}>
                Connect wallet
              </button>
            )}

            <form onSubmit={sendUSDC} noValidate style={{ maxWidth: 520, marginTop: 24 }}>
              <label>
                Recipient wallet address
                <input
                  style={fieldStyle}
                  type="text"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  placeholder="0x..."
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>

              <label style={{ display: 'block', marginTop: 20 }}>
                Amount (USDC)
                <input
                  style={fieldStyle}
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                  min="0.000001"
                  step="any"
                  required
                />
              </label>

              <p className="muted-text" style={{ marginTop: 12 }}>
                Available balance: {displayedBalance()} USDC
              </p>

              <button
                className="primary-button"
                type="submit"
                disabled={sending || !account}
              >
                {sending ? 'Processing...' : 'Review & Send USDC'}
              </button>

              {txStatus && (
                <p role="status" style={{ marginTop: 16, overflowWrap: 'anywhere' }}>
                  {txStatus}
                </p>
              )}

              {txHash && (
                <p style={{ marginTop: 12, overflowWrap: 'anywhere' }}>
                  Transaction:{' '}
                  <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">
                    View on Arc Explorer ↗
                  </a>
                </p>
              )}
            </form>
          </section>
        )}

        {active === 'Activity' && (
          <section className="panel" style={{ padding: 24, marginTop: 24 }}>
            <div className="panel-heading">
              <div>
                <h2>Activity</h2>
                <p>Confirmed payments saved in this browser.</p>
              </div>
            </div>

            {history.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">◷</div>
                <strong>No saved payments yet</strong>
                <p>New confirmed payments will appear here.</p>
              </div>
            ) : (
              history.map((tx) => <PaymentItem key={tx.hash} tx={tx} />)
            )}
          </section>
        )}

        {active === 'Assets' && (
          <section className="panel" style={{ padding: 24, marginTop: 24 }}>
            <h2>Assets</h2>
            <p>Your connected wallet's USDC balance on Arc Mainnet.</p>

            <div className="stat-card" style={{ marginTop: 20 }}>
              <div className="stat-heading">
                <span>USD Coin</span>
                <span className="stat-icon">◈</span>
              </div>
              <h2>{displayedBalance()} <span>USDC</span></h2>
              <p className="muted-text">
                {account ? 'Arc Mainnet' : 'Connect wallet to view assets'}
              </p>
              {account && (
                <button
                  className="small-button"
                  onClick={() => loadBalance(account)}
                  disabled={balanceLoading}
                >
                  {balanceLoading ? 'Refreshing...' : 'Refresh balance'}
                </button>
              )}
            </div>
          </section>
        )}

        {active === 'AI Assistant' && (
          <section className="panel" style={{ padding: 24, marginTop: 24 }}>
            <h2>AI Assistant</h2>
            <p>
              Your Quick Pay AI assistant workspace. AI-powered wallet guidance
              is not connected yet.
            </p>
            <div className="empty-state">
              <div className="empty-icon">✳</div>
              <strong>Smart wallet tools are coming</strong>
              <p>
                Review every address and transaction carefully before approving
                a wallet request.
              </p>
              <button className="primary-button" onClick={() => setActive('Payments')}>
                Go to Payments →
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
