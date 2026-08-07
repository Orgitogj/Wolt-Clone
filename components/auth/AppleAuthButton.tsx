import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

const AppleAuthButton = ({ onPress }: { onPress?: () => void }) => {
  return (
    <TouchableOpacity style={styles.appleButton} onPress={onPress}>
      <Ionicons name="logo-apple" size={18} color={'#fff'}></Ionicons>
      <Text style={styles.appleButtonText}>Sign in with apple</Text>
    </TouchableOpacity>
  );
};

export default AppleAuthButton;

const styles = StyleSheet.create({
  appleButton: {
    width: '100%',
    backgroundColor: '#000',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 17,
    paddingHorizontal: 14,
    borderRadius: 12,
    gap: 4,
  },
  appleButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
