/**
 * Persisted temporary generation draft.
 *
 * Data-source selection remains backend-owned. domainIds stores up to three
 * concrete domains so one generation request can explore a cross-domain
 * opportunity while preserving backward compatibility with domainId.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const initialDraft = {
  description: '',
  domainId: '',
  domainIds: [],
  country: 'Palestine',
  city: '',
  region: '',
  language: 'ANY',
  keywords: [],
  generationType: 'NORMAL_FREE',
  forceRefresh: false,
  personalizedDiscovery: false,
  autoDetectDomains: false,
};

export const useGenerationDraftStore = create(
  persist(
    (set) => ({
      draft: initialDraft,
      updateDraft: (patch) =>
        set((state) => ({
          draft: {
            ...state.draft,
            ...patch,
          },
        })),
      resetDraft: () => set({ draft: initialDraft }),
    }),
    {
      name: 'nexora_generation_draft',
      version: 4,
      migrate: (persistedState) => {
        const persistedDraft = persistedState?.draft ?? {};
        const legacyDomainId = persistedDraft.domainId;

        return {
          ...persistedState,
          draft: {
            ...initialDraft,
            ...persistedDraft,
            domainIds: Array.isArray(persistedDraft.domainIds)
              ? persistedDraft.domainIds
              : legacyDomainId
                ? [legacyDomainId]
                : [],
          },
        };
      },
    },
  ),
);
