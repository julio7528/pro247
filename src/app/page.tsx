import Image from "next/image";
import styles from "./page.module.css";

const navigation = [
  { label: "O produto", href: "#produto" },
  { label: "Funcionalidades", href: "#funcionalidades" },
  { label: "Preços", href: "#precos" },
];

const featureGroups = [
  {
    title: "Visão e análise",
    features: ["Dashboard", "Análise Financeira"],
  },
  {
    title: "Assistência",
    features: ["Agente Pro247"],
  },
  {
    title: "Caixa e contas",
    features: ["Fluxo de Caixa", "Contas Correntes"],
  },
  {
    title: "Planejamento e compromissos",
    features: ["Contas a Pagar", "Contas a Receber", "Orçamentos"],
  },
  {
    title: "Registros e demonstrativos",
    features: [
      "Livro Diário",
      "Livro-Razão e Razonete",
      "Balancete de Verificação",
      "Balanço Patrimonial",
      "Demonstração do Resultado (DRE)",
    ],
  },
  {
    title: "Cadastros",
    features: ["Cadastros — plano de contas e dimensões"],
  },
];

function ExperimentButton({ className = "" }: { className?: string }) {
  return (
    <button
      className={`${styles.experimentButton} ${className}`.trim()}
      type="button"
      disabled
    >
      <span>Cadastre-se para experimentar</span>
    </button>
  );
}

function FlowIllustration() {
  return (
    <svg
      aria-hidden="true"
      className={styles.flowIllustration}
      focusable="false"
      viewBox="0 0 620 520"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M74 347c72 0 73-159 165-159 91 0 73 133 162 133 49 0 80-31 135-31"
        fill="none"
        stroke="#F97316"
        strokeLinecap="round"
        strokeWidth="8"
      />
      <path
        d="M74 347c72 0 73-159 165-159 91 0 73 133 162 133 49 0 80-31 135-31"
        fill="none"
        stroke="#1F2937"
        strokeDasharray="1 20"
        strokeLinecap="round"
        strokeWidth="2"
      />

      <rect
        x="56"
        y="74"
        width="145"
        height="110"
        fill="#FFF7ED"
        stroke="#1F2937"
        strokeWidth="2"
      />

      <rect
        x="321"
        y="58"
        width="170"
        height="128"
        fill="#FFFFFF"
        stroke="#1F2937"
        strokeWidth="2"
      />

      <rect
        x="195"
        y="286"
        width="126"
        height="126"
        fill="#1F2937"
      />

      <rect
        x="409"
        y="324"
        width="137"
        height="112"
        fill="#FDBA74"
        stroke="#1F2937"
        strokeWidth="2"
      />

      <circle cx="74" cy="347" r="13" fill="#F97316" stroke="#FFF7ED" strokeWidth="5" />
      <circle cx="401" cy="321" r="13" fill="#F97316" stroke="#FFF7ED" strokeWidth="5" />
      <circle cx="536" cy="290" r="13" fill="#1F2937" stroke="#FFF7ED" strokeWidth="5" />
      <rect x="521" y="92" width="38" height="38" fill="#F97316" />
      <rect x="90" y="445" width="81" height="18" fill="#FDBA74" />
      <rect x="355" y="449" width="32" height="32" fill="#1F2937" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#conteudo">
        Ir para o conteúdo principal
      </a>

      <p className={styles.betaBar}>
        <span aria-hidden="true" className={styles.betaMark} />
        Pro247 em beta e em desenvolvimento
      </p>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.brand} href="#inicio" aria-label="Pro247 — início">
            <Image
              alt="Pro247"
              className={styles.wordmark}
              height={52}
              loading="eager"
              src="/pro247-wordmark.svg"
              width={204}
            />
          </a>

          <nav aria-label="Navegação principal" className={styles.navigation}>
            {navigation.map((item) => (
              <a href={item.href} key={item.href}>
                {item.label}
              </a>
            ))}
          </nav>

          <ExperimentButton className={styles.headerCta} />
        </div>
      </header>

      <main id="conteudo">
        <section aria-labelledby="hero-title" className={styles.hero} id="inicio">
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>Para quem trabalha por conta própria</p>
              <h1 id="hero-title">Conheça a plataforma Pro247.</h1>
              <p className={styles.heroDescription}>
                A Pro247 está em beta e em desenvolvimento. Sua proposta é reunir o
                acompanhamento financeiro e contábil de MEIs, profissionais
                autônomos, prestadores de serviços e pequenos comerciantes.
              </p>
              <ExperimentButton className={styles.heroCta} />
              <p className={styles.heroNote}>10 dias gratuitos · 50 consultas de IA</p>
            </div>

            <div className={styles.heroArt}>
              <FlowIllustration />
              <p className={styles.artCaption}>Gestão em fluxo</p>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="product-title"
          className={styles.productSection}
          id="produto"
        >
          <div className={styles.sectionShell}>
            <p className={styles.sectionKicker}>O produto</p>
            <div className={styles.productGrid}>
              <h2 id="product-title">Uma proposta para apoiar a autonomia financeira.</h2>
              <div className={styles.productCopy}>
                <p>
                  A Pro247 tem como propósito apoiar a autonomia financeira de quem
                  trabalha por conta própria. A plataforma em desenvolvimento propõe
                  aproximar o acompanhamento financeiro e contábil do negócio.
                </p>
                <a className={styles.textLink} href="#funcionalidades">
                  Conheça as funcionalidades <span aria-hidden="true">↓</span>
                </a>
              </div>
            </div>
            <div aria-hidden="true" className={styles.productRule}>
              <span />
            </div>
            <p className={styles.productFootnote}>
              Produto em beta e em desenvolvimento
            </p>
          </div>
        </section>

        <section
          aria-labelledby="features-title"
          className={styles.featuresSection}
          id="funcionalidades"
        >
          <div className={styles.sectionShell}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.sectionKicker}>O que compõe a plataforma</p>
                <h2 id="features-title">Uma gestão, diferentes frentes.</h2>
              </div>
              <p>
                Conheça as áreas que fazem parte da proposta Pro247 para a gestão
                financeira e contábil.
              </p>
            </div>

            <div className={styles.featureGrid}>
              {featureGroups.map((group, index) => (
                <section
                  aria-labelledby={`feature-group-${index}`}
                  className={styles.featureGroup}
                  key={group.title}
                >
                  <div className={styles.featureGroupHeading}>
                    <span aria-hidden="true">0{index + 1}</span>
                    <h3 id={`feature-group-${index}`}>{group.title}</h3>
                  </div>
                  <ul>
                    {group.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="trial-title" className={styles.trialSection} id="experimento">
          <div className={styles.trialInner}>
            <div className={styles.trialCopy}>
              <p className={styles.sectionKicker}>Experimento gratuito</p>
              <h2 id="trial-title">10 dias para experimentar a Pro247.</h2>
              <p>
                O experimento inclui 50 consultas de IA. Durante o beta, essa é a
                única opção disponível.
              </p>
            </div>
            <div className={styles.trialAction}>
              <div className={styles.trialCount}>
                <span>10</span>
                <p>dias gratuitos<br />50 consultas de IA</p>
              </div>
              <ExperimentButton className={styles.trialCta} />
            </div>
          </div>
        </section>

        <section aria-labelledby="pricing-title" className={styles.pricingSection} id="precos">
          <div className={styles.sectionShell}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.sectionKicker}>Valores informativos</p>
                <h2 id="pricing-title">Preços e planos</h2>
              </div>
              <p>
                Durante o beta, somente o experimento gratuito está disponível.
                Planos pagos ainda não podem ser contratados.
              </p>
            </div>

            <div className={styles.pricingGrid}>
              <div className={styles.fixedPrice}>
                <p className={styles.priceLabel}>Mensalidade fixa</p>
                <p className={styles.fixedAmount}>
                  <span>R$</span> 18,90 <small>por mês</small>
                </p>
              </div>
              <div className={styles.queryPrices}>
                <h3>Consultas e apoio de assistente financeiro</h3>
                <ul>
                  <li>
                    <span>1.000 consultas</span>
                    <strong>R$ 15,90</strong>
                  </li>
                  <li>
                    <span>2.000 consultas</span>
                    <strong>R$ 25,90</strong>
                  </li>
                  <li>
                    <span>3.000 consultas</span>
                    <strong>R$ 32,90</strong>
                  </li>
                </ul>
              </div>
            </div>
            <p className={styles.priceNotice}>
              Os valores de planos pagos são apenas informativos e não estão
              disponíveis para contratação durante o beta.
            </p>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <a className={styles.footerBrand} href="#inicio" aria-label="Pro247 — voltar ao início">
            <Image
              alt="Pro247"
              height={39}
              src="/pro247-wordmark.svg"
              width={153}
            />
          </a>
          <nav aria-label="Navegação do rodapé" className={styles.footerNav}>
            {navigation.map((item) => (
              <a href={item.href} key={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
          <p className={styles.footerStatus}>Em beta e em desenvolvimento</p>
        </div>
      </footer>
    </div>
  );
}
