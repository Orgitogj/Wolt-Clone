import AppleAuthButton from '@/components/auth/AppleAuthButton';
import GoogleAuthButton from '@/components/auth/GoogleAuthButton';
import { Colors, Fonts } from '@/constants/theme';
import useAuthStore from '@/hooks/use-auth-store';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import Ionic from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';


const Page = () => {
  const { signInWithOAuth, signInAnonymously } = useAuthStore();
  const [isContinuingAsGuest, setIsContinuingAsGuest] = useState(false);

  const router=useRouter() ;

  const handleOAuth = async (provider: 'apple' | 'google' | 'facebook') => {
    const { error } = await signInWithOAuth(provider);
    if (error) Alert.alert('Sign-in unavailable', error);
  };

  const continueAsGuest = async () => {
    setIsContinuingAsGuest(true);
    const { error } = await signInAnonymously();
    setIsContinuingAsGuest(false);
    if (error) Alert.alert('Could not continue as guest', error);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => router.dismiss()}>
          <Ionic name='close' size={24} color={'#000'} />
        </TouchableOpacity>
      </View>
      <Text style={styles.title}>Wolt account</Text>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.buttonContainer}>
                <Animated.View entering={FadeInDown.delay(100)} style={styles.buttonItem}>
                  <AppleAuthButton onPress={() => handleOAuth('apple')} />
                </Animated.View>
                <Animated.View entering={FadeInDown.delay(200)} style={styles.buttonItem}>
                  <GoogleAuthButton onPress={() => handleOAuth('google')} />
                </Animated.View>
                <Animated.View entering={FadeInDown.delay(300)} style={styles.buttonItem}>
                  <TouchableOpacity style={styles.facebookButton} onPress={() => handleOAuth('facebook')}>
                       <FontAwesome5 name='facebook' size={20} ></FontAwesome5>
                        <Text style={styles.facebookButtonText}>Continue with Facebook</Text>
                      </TouchableOpacity>
                </Animated.View>
                <Animated.View entering={FadeInDown.delay(350)} style={styles.buttonItem}>
                  <TouchableOpacity style={styles.emailButton} onPress={() => router.push('/email-auth')}>
                       <Ionic name='mail-outline' size={20} color={Colors.dark} ></Ionic>
                        <Text style={styles.facebookButtonText}>Continue with email</Text>
                      </TouchableOpacity>
                </Animated.View>
                <Animated.View entering={FadeInDown.delay(400)} style={styles.buttonItem}>
                  <TouchableOpacity style={styles.otherButton} onPress={continueAsGuest} disabled={isContinuingAsGuest}>
                        {isContinuingAsGuest ? (
                          <ActivityIndicator color={Colors.secondary} />
                        ) : (
                          <Text style={styles.otherButtonText}>Continue as guest</Text>
                        )}
                      </TouchableOpacity>
                </Animated.View>

              </ScrollView>
    </SafeAreaView>
  )
}


export default Page

const styles = StyleSheet.create({

container:{
  flex:1,
  paddingHorizontal:16,
  paddingTop: 14,
  backgroundColor: '#fff',
},
headerRow: {
  width: '100%',
  alignItems: 'flex-end',
  marginBottom: 8,
},
closeBtn: {
  backgroundColor: Colors.light,
  borderRadius: 40,
  padding: 8,
},

title:{
  fontSize:30,
  fontFamily:Fonts.brandBlack,
  marginTop: 0,
  marginBottom: 20,
  lineHeight: 36,
},
 scrollView: {
   flex: 1,
   width: '100%',
 },
 buttonContainer:{
    width:'100%',
    gap:12,
    alignItems:'center',
    alignSelf:'center',
    maxWidth: 360,
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingBottom: 8,
  },
  buttonItem:{
    width:'100%',
  },

      otherButton:{
      width:'100%',
      flexDirection:'row',
      alignItems:'center',
      justifyContent:'center',
      paddingVertical:17,
      paddingHorizontal:14,
      borderRadius:12,
      gap:4
      },
      otherButtonText:{
        color:Colors.secondary,
        fontSize:18,
        fontWeight:'600'
      },


     facebookButton:{
      width:'100%',
      backgroundColor:Colors.light,
      flexDirection:'row',
      alignItems:'center',
      justifyContent:'center',
      paddingVertical:17,
      paddingHorizontal:14,
      borderRadius:12,
      gap:4
     },
     facebookButtonText:{
       color:Colors.dark,
       fontSize:18,
       fontWeight:'600'
     },
     emailButton:{
      width:'100%',
      backgroundColor:Colors.light,
      flexDirection:'row',
      alignItems:'center',
      justifyContent:'center',
      paddingVertical:17,
      paddingHorizontal:14,
      borderRadius:12,
      gap:5
     }

})
