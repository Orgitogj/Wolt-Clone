import { supabase } from '@/lib/supabase';
import type { AppNotification, PushPlatform } from '@/types/database';

export const notificationService = {
  list: async (userId: string, limit = 50): Promise<AppNotification[]> => {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as AppNotification[];
  },

  unreadCount: async (userId: string): Promise<number> => {
    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) throw error;
    return count ?? 0;
  },

  markRead: async (ids?: string[]): Promise<number> => {
    const { data, error } = await supabase.rpc('mark_notifications_read', {
      p_ids: ids ?? null,
    });
    if (error) throw error;
    return (data as number) ?? 0;
  },

  registerPushToken: async (token: string, platform: PushPlatform): Promise<void> => {
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: platform,
    });
    if (error) throw error;
  },
};
