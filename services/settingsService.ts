import { supabase } from '@/lib/supabase';
import type { PlatformSettings } from '@/types/database';

export const settingsService = {
  get: async (): Promise<PlatformSettings> => {
    const { data, error } = await supabase.from('platform_settings').select('*').single();
    if (error) throw error;
    return data as PlatformSettings;
  },
};
