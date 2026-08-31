import { useEffect, useState } from 'react'
import { MarketLobby, type LobbyView } from './features/lobby/MarketLobby'

const sprintSteps = ['Discover', 'Decide', 'Execute', 'Settle', 'Review']
const workspaceViews: Array<{ id: LobbyView; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'markets', label: 'Live markets' },
  { id: 'coach', label: 'Coach' },
  { id: 'history', label: 'History' },
]

const workspaceCopy: Record<Exclude<LobbyView, 'overview'>, { eyebrow: string; title: string; emphasis: string; copy: string }> = {
  markets: {
    eyebrow: 'Workspace / Live markets',
    title: 'Trade a live window.',
    emphasis: 'With a bounded edge.',
    copy: 'Read the book, make one reasoned call, and see the exact risk before your wallet signs.',
  },
  coach: {
    eyebrow: 'Workspace / Coach',
    title: 'The market closes.',
    emphasis: 'The lesson stays.',
    copy: 'Return to queued reviews, see your reason duel commitments, and turn each result into a better next call.',
  },
  history: {
    eyebrow: 'Workspace / History',
    title: 'Keep the proof.',
    emphasis: 'Learn from the receipt.',
    copy: 'Your fills, settlement checks, redemptions, and decision scores stay connected to the market that created them.',
  },
}

function readViewFromHash(): LobbyView {
  if (typeof window === 'undefined') return 'overview'
  const hash = window.location.hash.slice(1)
  const value = (hash === 'lobby' ? 'markets' : hash) as LobbyView
  return workspaceViews.some((view) => view.id === value) ? value : 'overview'
}

function App() {
  const [view, setView] = useState<LobbyView>(readViewFromHash)

  useEffect(() => {
    const handleHashChange = () => setView(readViewFromHash())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  function navigate(nextView: LobbyView) {
    window.location.hash = nextView === 'overview' ? '' : nextView
    setView(nextView)
  }

  return (
    <main className={`app-shell app-view-${view}`}>
      <header className="topbar">
        <a className="brand" href="#" aria-label="SignalSprint home" onClick={() => navigate('overview')}>
          <span className="brand-mark">SS</span>
          <span>SignalSprint</span>
        </a>
        <nav className="workspace-nav" aria-label="SignalSprint workspace">
          {workspaceViews.map((item) => (
            <button
              className={`workspace-nav-link ${view === item.id ? 'active' : ''}`}
              type="button"
              key={item.id}
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => navigate(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="topbar-actions">
          <span className="network-pill"><span className="status-dot" /> Somnia testnet</span>
          <div id="navbar-wallet" />
        </div>
      </header>

      {view === 'overview' ? (
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">A decision receipt for every short market</p>
            <h1 id="hero-title">Trade the call.<br /><em>Prove the edge.</em></h1>
            <p className="hero-lede">
              Turn a live DreamDEX Event Contract into a bounded sprint, then see exactly
              what your decision cost, how it settled, and what to learn next.
            </p>
            <button className="primary-button" type="button" onClick={() => navigate('markets')}>Find a live sprint <span>-&gt;</span></button>
          </div>

          <div className="hero-card" aria-label="SignalSprint workflow preview">
            <div className="card-label">The loop</div>
            <div className="sprint-track">
              {sprintSteps.map((step, index) => (
                <div className={`track-step ${index === 0 ? 'active' : ''}`} key={step}>
                  <span className="step-number">0{index + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
            <div className="card-footnote">
              <span className="pulse-line" />
              Your history stays tied to the market ID, not a recycled pool.
            </div>
          </div>
        </section>
      ) : (
        <section className="workspace-banner" aria-labelledby="workspace-title">
          <div>
            <p className="eyebrow">{workspaceCopy[view].eyebrow}</p>
            <h1 id="workspace-title">{workspaceCopy[view].title}<br /><em>{workspaceCopy[view].emphasis}</em></h1>
          </div>
          <p className="workspace-banner-copy">{workspaceCopy[view].copy}</p>
        </section>
      )}

      <div id="lobby"><MarketLobby view={view} onViewChange={navigate} /></div>

      {view === 'overview' && <section className="preview-grid" aria-label="Product principles">
        <article>
          <span className="article-index">01</span>
          <h2>Small stakes.<br />Clear calls.</h2>
          <p>See the expiry, probability, and maximum loss before the wallet asks you to sign.</p>
        </article>
        <article className="accent-card">
          <span className="article-index">02</span>
          <h2>Results with<br />receipts.</h2>
          <p>Every fill, settlement, and redemption has a place in the decision record.</p>
        </article>
        <article>
          <span className="article-index">03</span>
          <h2>Learn before<br />the next window.</h2>
          <p>Build a private passport from real rounds, not vague hot takes.</p>
        </article>
      </section>}
    </main>
  )
}

export default App
