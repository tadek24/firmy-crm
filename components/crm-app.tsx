"use client";

import {
  BarChart3,
  Building2,
  ChevronRight,
  CircleDollarSign,
  ExternalLink,
  Filter,
  Globe2,
  LayoutDashboard,
  Phone,
  Search,
  Settings,
  Tags,
  UsersRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { demoCompanies } from "@/lib/mock-data";
import type { Company, LeadStatus } from "@/lib/types";

const statuses: LeadStatus[] = [
  "Nowy",
  "Do sprawdzenia",
  "Do kontaktu",
  "Kontakt wykonany",
  "Zainteresowany",
  "Oferta wysłana",
  "Negocjacje",
  "Klient",
  "Nie zainteresowany",
  "Nie kontaktować"
];

const STORAGE_KEY = "firmy-crm-demo-v1";

export function CrmApp() {
  const [companies, setCompanies] = useState<Company[]>(demoCompanies);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Wszystkie");
  const [leadStatus, setLeadStatus] = useState("Wszystkie");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setCompanies(JSON.parse(raw));
      } catch {
        // Keep demo data if local storage contains invalid JSON.
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(companies));
  }, [companies]);

  const categories = useMemo(
    () => ["Wszystkie", ...Array.from(new Set(companies.map((c) => c.category))).sort()],
    [companies]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("pl");
    return companies.filter((company) => {
      const matchesQuery =
        !q ||
        [
          company.name,
          company.nip,
          company.regon,
          company.krs,
          company.city,
          company.pkdMain,
          company.category,
          company.tags.join(" ")
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("pl")
          .includes(q);

      const matchesCategory =
        category === "Wszystkie" || company.category === category;

      const matchesStatus =
        leadStatus === "Wszystkie" || company.status === leadStatus;

      return matchesQuery && matchesCategory && matchesStatus;
    });
  }, [companies, query, category, leadStatus]);

  const selected = companies.find((company) => company.id === selectedId) ?? null;

  const updateCompany = (id: string, patch: Partial<Company>) => {
    setCompanies((current) =>
      current.map((company) =>
        company.id === id ? { ...company, ...patch } : company
      )
    );
  };

  const stats = {
    total: companies.length,
    toContact: companies.filter((c) => c.status === "Do kontaktu").length,
    interested: companies.filter((c) =>
      ["Zainteresowany", "Oferta wysłana", "Negocjacje"].includes(c.status)
    ).length,
    ecommerce: companies.filter((c) =>
      c.online.some((x) =>
        ["Sklep internetowy", "Shopify", "Allegro", "Amazon", "Ceneo"].includes(x)
      )
    ).length
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">F</div>
          <div>
            <strong>Firmy CRM</strong>
            <span>Prospecting</span>
          </div>
        </div>

        <nav className="nav">
          <button className="nav-item active">
            <LayoutDashboard size={18} />
            Firmy
          </button>
          <button className="nav-item">
            <Phone size={18} />
            Kontakty
          </button>
          <button className="nav-item">
            <Tags size={18} />
            Etykiety
          </button>
          <button className="nav-item">
            <BarChart3 size={18} />
            Raporty
          </button>
        </nav>

        <div className="sidebar-spacer" />

        <div className="sync-card">
          <span className="sync-dot" />
          <div>
            <strong>Tryb demonstracyjny</strong>
            <p>CEIDG/KRS zostanie podpięte w kolejnym etapie.</p>
          </div>
        </div>

        <button className="nav-item">
          <Settings size={18} />
          Ustawienia
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Baza prospektów</p>
            <h1>Firmy</h1>
          </div>
          <button className="primary-button">
            <Building2 size={17} />
            Import firm
          </button>
        </header>

        <section className="stats-grid">
          <StatCard
            icon={<Building2 size={20} />}
            label="Wszystkie firmy"
            value={stats.total}
            hint="w bazie demonstracyjnej"
          />
          <StatCard
            icon={<Phone size={20} />}
            label="Do kontaktu"
            value={stats.toContact}
            hint="oczekuje na telefon"
          />
          <StatCard
            icon={<CircleDollarSign size={20} />}
            label="Aktywne leady"
            value={stats.interested}
            hint="zainteresowani / oferta"
          />
          <StatCard
            icon={<Globe2 size={20} />}
            label="E-commerce"
            value={stats.ecommerce}
            hint="wykryta sprzedaż online"
          />
        </section>

        <section className="panel">
          <div className="toolbar">
            <div className="search">
              <Search size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Szukaj po nazwie, NIP, mieście, PKD lub tagu..."
              />
            </div>

            <div className="filters">
              <div className="filter-label">
                <Filter size={16} />
                Filtry
              </div>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <select value={leadStatus} onChange={(e) => setLeadStatus(e.target.value)}>
                <option>Wszystkie</option>
                {statuses.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="result-row">
            <span>
              Znaleziono <strong>{filtered.length}</strong> firm
            </span>
            <span className="muted">Kliknij firmę, aby otworzyć kartę</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Firma</th>
                  <th>PKD / kategoria</th>
                  <th>Lokalizacja</th>
                  <th>Obecność online</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((company) => (
                  <tr key={company.id} onClick={() => setSelectedId(company.id)}>
                    <td>
                      <div className="company-cell">
                        <div className="company-avatar">{company.name.charAt(0)}</div>
                        <div>
                          <strong>{company.name}</strong>
                          <span>
                            {company.source} · NIP {company.nip}
                          </span>
                          <div className="tag-row">
                            {company.tags.slice(0, 3).map((tag) => (
                              <span className="tag" key={tag}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong className="mono">{company.pkdMain}</strong>
                      <span className="subtle">{company.category}</span>
                    </td>
                    <td>
                      <strong>{company.city}</strong>
                      <span className="subtle">{company.voivodeship}</span>
                    </td>
                    <td>
                      <div className="online-list">
                        {company.online.length === 0 ? (
                          <span className="muted">brak danych</span>
                        ) : (
                          company.online.slice(0, 3).map((item) => (
                            <span className="online-pill" key={item}>
                              {item}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={company.status} />
                    </td>
                    <td className="arrow-cell">
                      <ChevronRight size={18} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {selected && (
        <CompanyDrawer
          company={selected}
          onClose={() => setSelectedId(null)}
          onUpdate={(patch) => updateCompany(selected.id, patch)}
        />
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: LeadStatus }) {
  const tone =
    status === "Klient" || status === "Zainteresowany"
      ? "green"
      : status === "Oferta wysłana" || status === "Negocjacje"
        ? "blue"
        : status === "Nie zainteresowany" || status === "Nie kontaktować"
          ? "red"
          : "gray";

  return <span className={`status status-${tone}`}>{status}</span>;
}

function CompanyDrawer({
  company,
  onClose,
  onUpdate
}: {
  company: Company;
  onClose: () => void;
  onUpdate: (patch: Partial<Company>) => void;
}) {
  const [tagDraft, setTagDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState(company.note ?? "");

  useEffect(() => {
    setNoteDraft(company.note ?? "");
  }, [company.id, company.note]);

  const addTag = () => {
    const tag = tagDraft.trim();
    if (!tag || company.tags.includes(tag)) return;
    onUpdate({ tags: [...company.tags, tag] });
    setTagDraft("");
  };

  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className="drawer" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <span className="source-label">{company.source}</span>
            <h2>{company.name}</h2>
            <p>
              NIP {company.nip}
              {company.krs ? ` · KRS ${company.krs}` : ""}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Zamknij">
            <X size={20} />
          </button>
        </div>

        <div className="drawer-section">
          <label className="field-label">Status leada</label>
          <select
            className="full-select"
            value={company.status}
            onChange={(event) =>
              onUpdate({ status: event.target.value as LeadStatus })
            }
          >
            {statuses.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </div>

        <div className="contact-grid">
          <Info label="Telefon" value={company.phone ?? "—"} />
          <Info label="E-mail" value={company.email ?? "—"} />
          <Info label="Miasto" value={company.city} />
          <Info label="Województwo" value={company.voivodeship} />
        </div>

        <div className="drawer-section">
          <div className="section-title">
            <h3>PKD i kategoria</h3>
          </div>
          <div className="pkd-card">
            <strong>{company.pkdMain}</strong>
            <p>{company.pkdName}</p>
            <span>{company.category}</span>
          </div>
        </div>

        <div className="drawer-section">
          <div className="section-title">
            <h3>Obecność online</h3>
            {company.website && (
              <a href={company.website} target="_blank" rel="noreferrer">
                Otwórz WWW <ExternalLink size={14} />
              </a>
            )}
          </div>
          <div className="presence-grid">
            {company.online.length === 0 ? (
              <p className="muted">Nie wykryto jeszcze kanałów online.</p>
            ) : (
              company.online.map((item) => (
                <div className="presence-item" key={item}>
                  <span className="presence-check">✓</span>
                  {item}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="drawer-section">
          <div className="section-title">
            <h3>Etykiety</h3>
          </div>
          <div className="tag-editor">
            {company.tags.map((tag) => (
              <button
                className="tag removable"
                key={tag}
                onClick={() => onUpdate({ tags: company.tags.filter((x) => x !== tag) })}
                title="Kliknij, aby usunąć"
              >
                {tag} ×
              </button>
            ))}
          </div>
          <div className="inline-form">
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addTag();
              }}
              placeholder="Nowa etykieta"
            />
            <button onClick={addTag}>Dodaj</button>
          </div>
        </div>

        <div className="drawer-section">
          <div className="section-title">
            <h3>Notatka</h3>
          </div>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Notatka po rozmowie, ustalenia, następny krok..."
          />
          <button
            className="secondary-button"
            onClick={() => onUpdate({ note: noteDraft })}
          >
            Zapisz notatkę
          </button>
        </div>

        <div className="drawer-section">
          <div className="section-title">
            <h3>Szybkie działania</h3>
          </div>
          <div className="action-grid">
            <a
              className={`action-button ${!company.phone ? "disabled" : ""}`}
              href={company.phone ? `tel:${company.phone.replace(/\s/g, "")}` : undefined}
            >
              <Phone size={17} />
              Zadzwoń
            </a>
            {company.website ? (
              <a
                className="action-button"
                href={company.website}
                target="_blank"
                rel="noreferrer"
              >
                <Globe2 size={17} />
                Strona WWW
              </a>
            ) : (
              <span className="action-button disabled">
                <Globe2 size={17} />
                Brak WWW
              </span>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-box">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
