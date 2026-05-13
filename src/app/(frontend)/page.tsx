import React from 'react'

import config from '@/payload.config'
import './styles.css'

export default async function HomePage() {
  const payloadConfig = await config

  return (
    <div className="home">
      <header className="siteHeader">
        <a className="brandMark" href="/" aria-label="Evergreen Media home">
          <img
            alt="Evergreen Media"
            src="/evergreen-logo.png"
          />
        </a>
        <nav className="siteNav" aria-label="Primary">
          <a href="/upload">Upload</a>
          <a
            href={payloadConfig.routes.admin}
            rel="noopener noreferrer"
            target="_blank"
          >
            Admin
          </a>
        </nav>
      </header>

      <section className="hero" aria-labelledby="home-title">
        <div className="heroCopy">
          <p className="eyebrow">Fresh. Enduring. Relevant.</p>
          <h1 id="home-title">
            Digital asset management for Evergreen Media.
          </h1>
          <p className="lede">
            A branded home for collecting image submissions, organizing publication assets, and
            keeping creative work moving for Rapid City and the Black Hills.
          </p>
          <div className="homeActions">
            <a className="primaryAction" href="/upload">
              Start an upload
            </a>
            <a
              className="secondaryAction"
              href={payloadConfig.routes.admin}
              rel="noopener noreferrer"
              target="_blank"
            >
              Open admin
            </a>
          </div>
        </div>
        <div className="heroPanel" aria-label="Evergreen Media production highlights">
          <div>
            <span>869k</span>
            <p>Printed magazines produced each year</p>
          </div>
          <div>
            <span>Print + Digital</span>
            <p>Publication assets, web content, and customer submissions in one workflow</p>
          </div>
          <div>
            <span>Public uploads</span>
            <p>Contributors can send images without Payload admin access</p>
          </div>
        </div>
      </section>

      <footer className="siteFooter">
        <a href="https://evergreenmediarc.com/" rel="noopener noreferrer" target="_blank">
          evergreenmediarc.com
        </a>
      </footer>
    </div>
  )
}
