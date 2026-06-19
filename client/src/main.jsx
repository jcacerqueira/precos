import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const api = async (path, options = {}) => {
  const adminKey = localStorage.getItem('adminKey') || '';
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(adminKey ? { 'x-admin-api-key': adminKey } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro na API');
  return data;
};

function money(value) {
  if (value === null || value === undefined) return '-';
  return `${Number(value).toFixed(2).replace('.', ',')} €`;
}

function App() {
  const [products, setProducts] = useState([]);
  const [recent, setRecent] = useState([]);
  const [stores, setStores] = useState([]);
  const [adminKey, setAdminKey] = useState(localStorage.getItem('adminKey') || '');
  const [form, setForm] = useState({ name: '', context: '', targetPrice: '' });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const promoCount = useMemo(() => products.filter(p => p.best_result?.isPromo).length, [products]);

  async function load() {
    const [p, r, s] = await Promise.all([
      api('/api/products'),
      api('/api/results/recent?limit=50'),
      api('/api/stores')
    ]);
    setProducts(p);
    setRecent(r);
    setStores(s);
  }

  useEffect(() => { load().catch(e => setMessage(e.message)); }, []);

  function saveKey() {
    localStorage.setItem('adminKey', adminKey);
    setMessage('Admin API key guardada neste browser.');
  }

  async function addProduct(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await api('/api/products', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          context: form.context,
          targetPrice: form.targetPrice ? Number(form.targetPrice) : null
        })
      });
      setForm({ name: '', context: '', targetPrice: '' });
      setMessage('Produto adicionado. Usa “Verificar preços agora” para procurar já.');
      await load();
    } catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }

  async function removeProduct(id) {
    if (!confirm('Remover este produto?')) return;
    setLoading(true);
    try {
      await api(`/api/products/${id}`, { method: 'DELETE' });
      await load();
    } catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }

  async function adminAction(path, label) {
    setLoading(true);
    setMessage(`${label}...`);
    try {
      const result = await api(path, { method: 'POST', body: '{}' });
      setMessage(`${label}: concluído. ${JSON.stringify(result.result || { ok: result.ok })}`);
      await load();
    } catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }

  return <div className="app">
    <header>
      <div>
        <h1>PriceWatch PT</h1>
        <p>Alertas de promoção e resumo diário dos teus produtos mais baratos.</p>
      </div>
      <div className="stats">
        <span>{products.length} produtos</span>
        <span>{promoCount} promoções</span>
      </div>
    </header>

    <section className="card admin">
      <h2>Admin</h2>
      <div className="row">
        <input type="password" placeholder="ADMIN_API_KEY" value={adminKey} onChange={e => setAdminKey(e.target.value)} />
        <button onClick={saveKey}>Guardar key</button>
      </div>
      <div className="actions">
        <button disabled={loading} onClick={() => adminAction('/api/admin/check-now', 'Verificar preços agora')}>Verificar preços agora</button>
        <button disabled={loading} onClick={() => { if (confirm('Apagar todos os últimos resultados e histórico de notificações? Os produtos monitorizados ficam guardados.')) adminAction('/api/admin/reset-results', 'Reset aos últimos resultados'); }}>Reset resultados</button>
        <button disabled={loading} onClick={() => adminAction('/api/admin/smtp-diagnostics', 'Diagnóstico SMTP')}>Diagnóstico SMTP</button>
        <button disabled={loading} onClick={() => adminAction('/api/admin/send-summary-test', 'Enviar email resumo teste')}>Enviar resumo teste</button>
        <button disabled={loading} onClick={() => adminAction('/api/admin/send-promotion-test', 'Enviar email promoção teste')}>Enviar promoção teste</button>
        <button disabled={loading} onClick={() => adminAction('/api/admin/run-daily', 'Executar rotina diária')}>Executar rotina diária</button>
      </div>
      {message && <p className="message">{message}</p>}
    </section>

    <section className="card">
      <h2>Lojas ativas</h2>
      <p className="hint">Por defeito a app usa só as lojas que têm maior probabilidade de devolver resultados públicos. Podes alterar isto com ENABLED_STORES no Railway.</p>
      <div className="chips">
        {stores.map(store => <span key={store.key} className={store.enabled ? 'chip on' : 'chip off'} title={store.note || ''}>
          {store.name} {store.enabled ? 'ativo' : 'desligado'}
        </span>)}
      </div>
    </section>

    <section className="card">
      <h2>Adicionar produto</h2>
      <form onSubmit={addProduct} className="product-form">
        <label>Nome do produto
          <input required placeholder="Ex: Santal laranja cenoura 1.5L" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>Contexto opcional
          <input placeholder="Ex: néctar, pacote 1.5L, marca Santal" value={form.context} onChange={e => setForm({ ...form, context: e.target.value })} />
        </label>
        <label>Preço alvo opcional
          <input type="number" step="0.01" placeholder="Ex: 1.50" value={form.targetPrice} onChange={e => setForm({ ...form, targetPrice: e.target.value })} />
        </label>
        <button disabled={loading}>Adicionar</button>
      </form>
    </section>

    <section className="card">
      <h2>Produtos monitorizados</h2>
      <div className="table">
        <div className="tr th"><span>Produto</span><span>Loja mais barata</span><span>Preço</span><span>Estado</span><span>Link</span><span></span></div>
        {products.map(p => <div className="tr" key={p.id}>
          <span><strong>{p.name}</strong>{p.context ? <small>{p.context}</small> : null}</span>
          <span>{p.best_result?.store || 'Sem resultado'}</span>
          <span>{p.best_result?.price ? money(p.best_result.price) : '-'}</span>
          <span>{p.best_result?.isPromo ? <b className="promo">Promoção</b> : 'Normal'}</span>
          <span>{p.best_result?.url ? <a href={p.best_result.url} target="_blank" rel="noreferrer">Abrir loja</a> : '-'}</span>
          <span><button className="ghost" onClick={() => removeProduct(p.id)}>Remover</button></span>
        </div>)}
        {!products.length && <p className="empty">Ainda não adicionaste produtos.</p>}
      </div>
    </section>

    <section className="card">
      <h2>Últimos resultados encontrados</h2>
      <div className="results">
        {recent.map(r => <article key={r.id}>
          <div>
            <strong>{r.product_name}</strong>
            <p>{r.title}</p>
            {r.url && <a href={r.url} target="_blank" rel="noreferrer">Abrir loja</a>}
          </div>
          <div><b>{r.store}</b><span>{money(r.price)}</span>{r.is_promo && <em>Promoção</em>}</div>
        </article>)}
        {!recent.length && <p className="empty">Sem resultados ainda. Clica em “Verificar preços agora”.</p>}
      </div>
    </section>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
