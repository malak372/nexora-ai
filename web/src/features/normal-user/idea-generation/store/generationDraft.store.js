/** Persisted temporary generation draft. Backend-owned source selection is not stored here. */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
const initialDraft = { description: '', domainId: '', country: 'Palestine', city: '', region: '', radiusKm: '', language: 'ANY', keywords: [], generationType: 'NORMAL_FREE', forceRefresh: false };
export const useGenerationDraftStore = create(persist(set => ({ draft: initialDraft, updateDraft: patch => set(state => ({ draft: { ...state.draft, ...patch } })), resetDraft: () => set({ draft: initialDraft }) }), { name: 'nexora_generation_draft' }));
