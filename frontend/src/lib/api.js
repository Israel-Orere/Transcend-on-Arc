import { API_BASE } from "./chain";

async function get(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed: ${path}`);
  return res.json();
}

async function put(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed: ${path}`);
  return res.json();
}

export const api = {
  deals: (status) => get(`/deals${status ? `?status=${status}` : ""}`),
  deal: (id) => get(`/deals/${id}`),
  businesses: () => get(`/businesses`),
  business: (address) => get(`/businesses/${address}`),
  verifiers: () => get(`/verifiers`),
  profile: (address) => get(`/profiles/${address}`),
  updateProfile: (address, payload) => put(`/profiles/${address}`, payload),
  investorPortfolio: (address) => get(`/investors/${address}`),
};
