/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';

type Endpoint = {
  name: string;
  path: string;
  method: string;
  params: { name: string; type: string; required: boolean }[];
};

const ENDPOINTS: Endpoint[] = [
  { name: 'Search', path: '/api/search', method: 'GET', params: [{ name: 'keyword', type: 'text', required: true }] },
  { name: 'Episodes', path: '/api/episodes', method: 'GET', params: [{ name: 'id', type: 'text', required: true }] },
  { name: 'Servers', path: '/api/servers', method: 'GET', params: [{ name: 'id', type: 'text', required: true }, { name: 'ep', type: 'text', required: true }] },
  { name: 'Stream', path: '/api/stream', method: 'GET', params: [{ name: 'id', type: 'text', required: true }, { name: 'ep', type: 'text', required: true }, { name: 'server', type: 'text', required: true }, { name: 'type', type: 'text', required: false }] },
];

export default function App() {
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint>(ENDPOINTS[0]);
  const [params, setParams] = useState<Record<string, string>>({});
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleParamChange = (name: string, value: string) => {
    setParams(prev => ({ ...prev, [name]: value }));
  };

  const handleTest = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      let finalPath = selectedEndpoint.path;
      const queryParams = new URLSearchParams();

      for (const param of selectedEndpoint.params) {
        if (finalPath.includes(`:${param.name}`)) {
          finalPath = finalPath.replace(`:${param.name}`, encodeURIComponent(params[param.name] || ''));
        } else if (params[param.name]) {
          queryParams.append(param.name, params[param.name]);
        }
      }

      const queryString = queryParams.toString();
      const url = `${finalPath}${queryString ? `?${queryString}` : ''}`;

      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `HTTP error! status: ${res.status}`);
      }

      setResponse(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Anime Scraper API Tester</h1>
          <p className="text-gray-500">Test the endpoints for the anime scraping backend.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-1 space-y-6 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Select Endpoint</label>
              <select
                className="w-full rounded-lg border-gray-300 bg-gray-50 p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                value={selectedEndpoint.name}
                onChange={(e) => {
                  const endpoint = ENDPOINTS.find(ep => ep.name === e.target.value);
                  if (endpoint) {
                    setSelectedEndpoint(endpoint);
                    setParams({});
                  }
                }}
              >
                {ENDPOINTS.map(ep => (
                  <option key={ep.name} value={ep.name}>{ep.method} {ep.name}</option>
                ))}
              </select>
            </div>

            {selectedEndpoint.params.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-gray-700">Parameters</h3>
                {selectedEndpoint.params.map(param => (
                  <div key={param.name} className="space-y-1">
                    <label className="text-xs text-gray-500">
                      {param.name} {param.required && <span className="text-red-500">*</span>}
                    </label>
                    <input
                      type={param.type}
                      className="w-full rounded-lg border-gray-300 bg-gray-50 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={`Enter ${param.name}...`}
                      value={params[param.name] || ''}
                      onChange={(e) => handleParamChange(param.name, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleTest}
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Sending Request...' : 'Test Endpoint'}
            </button>
          </div>

          <div className="md:col-span-2 space-y-4">
            <div className="bg-gray-900 rounded-2xl overflow-hidden shadow-sm flex flex-col h-[600px]">
              <div className="bg-gray-800 px-4 py-3 flex items-center justify-between border-b border-gray-700">
                <span className="text-xs font-mono text-gray-400">Response Data</span>
                {loading && <span className="text-xs text-blue-400 animate-pulse">Fetching...</span>}
              </div>
              <div className="p-4 overflow-auto flex-1 text-sm font-mono text-gray-300">
                {error ? (
                  <div className="text-red-400">Error: {error}</div>
                ) : response ? (
                  <pre className="whitespace-pre-wrap break-all">{JSON.stringify(response, null, 2)}</pre>
                ) : (
                  <div className="text-gray-500 italic">No request made yet. Select an endpoint and test it to see results.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
