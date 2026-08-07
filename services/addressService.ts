import { supabase } from '@/lib/supabase';
import type { Address } from '@/types/database';

export interface NewAddress {
  label: string;
  address_line: string;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export const addressService = {
  list: async (userId: string): Promise<Address[]> => {
    const { data, error } = await supabase
      .from('addresses')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  add: async (userId: string, address: NewAddress): Promise<Address> => {
    const { data, error } = await supabase
      .from('addresses')
      .insert({ user_id: userId, ...address })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  remove: async (addressId: string): Promise<void> => {
    const { error } = await supabase.from('addresses').delete().eq('id', addressId);
    if (error) throw error;
  },
};
