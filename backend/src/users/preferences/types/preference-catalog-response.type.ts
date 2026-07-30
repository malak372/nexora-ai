import { PreferenceCategory } from '@prisma/client';

/**
 * Represents one selectable preference card returned to clients.
 *
 * @author Malak
 */
export type PreferenceCatalogOption = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: PreferenceCategory;
  imageUrl: string | null;
  iconKey: string | null;
  displayOrder: number;
  selected: boolean;
};

/**
 * Represents one grouped preference category.
 *
 * @author Malak
 */
export type PreferenceCatalogGroup = {
  category: PreferenceCategory;
  options: PreferenceCatalogOption[];
};
