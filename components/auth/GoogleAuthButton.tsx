import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

const GoogleAuthButton = ({ onPress }: { onPress?: () => void }) => {
  return (
    <TouchableOpacity style={styles.googleButton} onPress={onPress}>
      <Ionicons name="logo-google" size={18} color={'#fff'}></Ionicons>
      <Text style={styles.googleButtonText}>Continue with google</Text>
    </TouchableOpacity>
  );
};

export default GoogleAuthButton;

const styles = StyleSheet.create({
  googleButton: {
    width: '100%',
    backgroundColor: '#4285F4',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 17,
    paddingHorizontal: 14,
    borderRadius: 12,
    gap: 4,
  },
  googleButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
