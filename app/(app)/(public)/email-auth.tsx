import { Colors, Fonts } from '@/constants/theme';
import useAuthStore from '@/hooks/use-auth-store';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native';

const Page = () => {
  const router = useRouter();
  const { signInWithEmail, signUpWithEmail } = useAuthStore();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setError(null);
    setInfoMessage(null);
    setIsSubmitting(true);

    if (mode === 'signin') {
      const { error: authError } = await signInWithEmail(email.trim(), password);
      setIsSubmitting(false);
      if (authError) setError(authError);
      // On success the root layout's auth guard swaps to the authenticated stack automatically.
      return;
    }

    const { error: authError, needsEmailConfirmation } = await signUpWithEmail(
      email.trim(),
      password,
      fullName.trim() || undefined
    );
    setIsSubmitting(false);

    if (authError) {
      setError(authError);
      return;
    }

    if (needsEmailConfirmation) {
      setInfoMessage('Account created! Check your email to confirm it, then log in.');
      setMode('signin');
    }
    // If no confirmation is required, a session is already active and the auth guard navigates away.
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TouchableOpacity style={styles.closeBtn} onPress={() => router.dismiss()}>
        <Ionicons name="close" size={24} color={'#000'} />
      </TouchableOpacity>

      <Text style={styles.title}>{mode === 'signin' ? 'Log in' : 'Create account'}</Text>

      {mode === 'signup' && (
        <TextInput
          style={styles.input}
          placeholder="Full name"
          placeholderTextColor={Colors.muted}
          autoCapitalize="words"
          value={fullName}
          onChangeText={setFullName}
        />
      )}
      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={Colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={Colors.muted}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {infoMessage && <Text style={styles.infoText}>{infoMessage}</Text>}
      {error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={isSubmitting}>
        {isSubmitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitButtonText}>
            {mode === 'signin' ? 'Log in' : 'Create account'}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.switchModeButton}
        onPress={() => {
          setError(null);
          setMode(mode === 'signin' ? 'signup' : 'signin');
        }}>
        <Text style={styles.switchModeText}>
          {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
        </Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
};

export default Page;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 14,
    backgroundColor: '#fff',
  },
  closeBtn: {
    backgroundColor: Colors.light,
    borderRadius: 40,
    padding: 8,
    alignSelf: 'flex-end',
    marginRight: 20,
  },
  title: {
    fontSize: 30,
    fontFamily: Fonts.brandBlack,
    marginVertical: 22,
    paddingHorizontal: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.light,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#000',
    marginBottom: 12,
    marginHorizontal: 6,
  },
  infoText: {
    color: Colors.secondary,
    fontSize: 14,
    marginBottom: 12,
    marginHorizontal: 6,
  },
  errorText: {
    color: '#ff4646',
    fontSize: 14,
    marginBottom: 12,
    marginHorizontal: 6,
  },
  submitButton: {
    backgroundColor: Colors.secondary,
    paddingVertical: 17,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 6,
    marginTop: 4,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  switchModeButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  switchModeText: {
    color: Colors.secondary,
    fontSize: 15,
    fontWeight: '600',
  },
});
