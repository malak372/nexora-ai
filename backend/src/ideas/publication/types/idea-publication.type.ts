import type {
  IDEA_PUBLICATION_AUDIENCE_TYPES,
  PUBLICATION_DESCRIPTION_LANGUAGES,
} from '../constants/idea-publication.constants';

/**
 * Supported persisted publication-audience rule type.
 *
 * @author Malak
 */
export type IdeaPublicationAudienceType =
  (typeof IDEA_PUBLICATION_AUDIENCE_TYPES)[number];

/**
 * Supported AI-generated publication-description language.
 *
 * @author Malak
 */
export type PublicationDescriptionLanguage =
  (typeof PUBLICATION_DESCRIPTION_LANGUAGES)[number];

/**
 * Normalized audience rule used by publication services.
 *
 * @author Malak
 */
export type IdeaPublicationAudienceRule = {
  audienceType: IdeaPublicationAudienceType;
  audienceValue: string;
};

/**
 * Result returned by AI-assisted public-description generation.
 *
 * @author Malak
 */
export type GeneratedPublicationDescription = {
  ideaId: string;
  description: string;
  language: PublicationDescriptionLanguage;
  maxWords: number;
  generatedByAi: true;
  saved: false;
};
