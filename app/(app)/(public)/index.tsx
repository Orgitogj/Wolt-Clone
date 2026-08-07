import AppleAuthButton from "@/components/auth/AppleAuthButton";
import GoogleAuthButton from "@/components/auth/GoogleAuthButton";
import SmoothInfiniteScroll from "@/components/SmoothInfiniteScroll";
import { Fonts } from "@/constants/theme";
import useAuthStore from "@/hooks/use-auth-store";
import { LinearGradient } from 'expo-linear-gradient';
import { Link } from "expo-router";
import {
    Alert,
    Image,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function Index() {
  const { signInWithOAuth } = useAuthStore();
  const insets = useSafeAreaInsets();

  const handleOAuth = async (provider: 'apple' | 'google') => {
    const { error } = await signInWithOAuth(provider);
    if (error) Alert.alert('Sign-in unavailable', error);
  };

  const showPrivacyStatement = () => {
    Alert.alert(
      'Privacy statement',
      'This is a demo app built on Supabase. No real personal data is processed by a company called Wolt.'
    );
  };
  return (
    <View style={styles.container}>
      <View style={styles.infiniteScrollContainer}>
        <View>
          <SmoothInfiniteScroll scrollDirection="down" iconSet="set1" />
        </View>
        <View>
          <SmoothInfiniteScroll scrollDirection="up" iconSet="set2" />
        </View>
        <View>
          <SmoothInfiniteScroll scrollDirection="down" iconSet="set3" />
        </View>

        <LinearGradient
          colors={['transparent', 'white']}
          style={{ position: 'absolute', height: 200, left: 0, bottom: 0, right: 0 }}
        />
      </View>

      <View style={[styles.contentContainer, { paddingBottom: insets.bottom + 20 }]}>
        <Image source={require('@/assets/images/wolt-logo.png')} style={styles.brandLogo} />

        <Animated.View entering={FadeInDown}>
          <Text style={styles.tagLine}>Almost everything delivered</Text>
        </Animated.View>

        <View style={styles.buttonContainer}>
          <Animated.View entering={FadeInDown.delay(100)} style={styles.buttonItem}>
            <AppleAuthButton onPress={() => handleOAuth('apple')} />
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(200)} style={styles.buttonItem}>
            <GoogleAuthButton onPress={() => handleOAuth('google')} />
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(300)} style={styles.buttonItem}>
            <Link href='/other-options' style={{textDecorationLine:'none'}} asChild>
              <TouchableOpacity style={styles.otherButton}>
                <Text style={styles.otherButtonText}>Other options</Text>
              </TouchableOpacity>
            </Link>
          </Animated.View>
        </View>

        <Animated.View style={styles.privacyContainer} entering={FadeInDown.delay(400)}>
          <Text style={styles.privacyText}>
            Please Visit {''}
            <Text style={styles.privayLink} onPress={showPrivacyStatement}>
              Wolt privacy statement
            </Text>{''}
            to learn about personal data processing at Wolt
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}


const styles =StyleSheet.create({

  container:{
    flex: 1,
    backgroundColor:'#fff',
  },

  // Sizes to its content so the logo/tagline can never be squeezed or overlapped
  // by the button stack on shorter screens.
  contentContainer:{
    alignItems:'center',
    paddingHorizontal:30,
    paddingTop:8,
  },

  infiniteScrollContainer:{
      flex:1,
      flexDirection:'row',
      justifyContent:'center',
      alignItems:'center',
      gap:4,
      position:'relative',
      overflow:'hidden',
  },

  brandLogo:{
      width:'100%',
      height:40,
      resizeMode:'contain',
      marginBottom:16

  },
  tagLine:{
    fontSize:28,
    fontFamily:Fonts.brandBold,
    textAlign:'center',
    marginBottom:24,
    lineHeight:34

  },
  buttonContainer:{
    width:'100%',
    gap:12,
    alignItems:'center',
    alignSelf:'center',
    maxWidth: 360,
  },

      otherButton:{
      width:'100%',
      backgroundColor:'#f0f0f0',
      flexDirection:'row',
      alignItems:'center',
      justifyContent:'center',
      paddingVertical:17,
      paddingHorizontal:14,
      borderRadius:12,
      gap:4
      },
      buttonItem:{
        width:'100%',
      },
      otherButtonText:{
        color:'#666',
        fontSize:18,
        fontWeight:'600'
      },
      privacyContainer:{
            marginTop:10,
            paddingHorizontal:20,
      },
      privacyText:{
        fontSize:12,
        color:'#999',
        textAlign:'center',
        lineHeight:18,
      },
      privayLink:{
        color:'#4285F4',
        textDecorationLine:'underline'
      }
  
})