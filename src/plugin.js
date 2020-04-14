const AWSCognito = require('amazon-cognito-identity-js');
const AWS = require('aws-sdk');

// Login with Cognito User Pool
const authenticate = ({ Username, Password, UserPoolId, ClientId }) =>
  new Promise((resolve, reject) => {
    const userPool = new AWSCognito.CognitoUserPool({ UserPoolId, ClientId });
    const cognitoUser = new AWSCognito.CognitoUser({
      Username,
      Pool: userPool,
    });
    const authenticationDetails = new AWSCognito.AuthenticationDetails({
      Username,
      Password,
    });
    cognitoUser.authenticateUser(authenticationDetails, {
      onSuccess: (result) => {
        resolve({
          idToken: result.getIdToken().getJwtToken(),
          accessToken: result.getAccessToken().getJwtToken(),
        });
      },
      onFailure: (error) => {
        console.error(error);
        reject(error);
      },
      newPasswordRequired: function () {
        console.error('Given user needs to set a new password');
        reject('Given user needs to set a new password');
      },
      mfaRequired: function () {
        console.error('MFA is not currently supported');
        reject('MFA is not currently supported');
      },
      customChallenge: function () {
        console.error('Custom challenge is not currently supported');
        reject('Custom challenge is not currently supported');
      },
    });
  });

// Get temporary credentials
async function getCredentials(userTokens, { UserPoolId, IdentityPoolId, CognitoRegion }) {
  console.log('Getting temporary credentials');

  const logins = {};
  const { idToken } = userTokens;

  logins[`cognito-idp.${CognitoRegion}.amazonaws.com/${UserPoolId}`] = idToken;

  AWS.config.update({ region: CognitoRegion });
  const credentials = new AWS.CognitoIdentityCredentials({
    IdentityPoolId,
    Logins: logins,
  });

  await credentials.getPromise();

  console.log('Got credentials:', credentials);

  return credentials;
}

// Validate if the credentials have expired
const validCredentials = (credentials) => {
  if (credentials.error) {
    return true;
  }

  const now = Date.now().valueOf();
  return now < credentials.expireTime;
};

const loadCredentials = async (context, key) => {
  const credentialsJson = await context.store.getItem(key);
  try {
    const credentials = credentialsJson && JSON.parse(credentialsJson);

    if (credentials && validCredentials(credentials)) {
      if (credentials.error) {
        // Display error
        console.error('Error credentials:', credentials.error);
        throw credentials.error;
      }

      return credentials;
    }
  } catch (e) {
    console.error('Error loading credentials:', e);
    context.store.removeItem(key);
  }

  return null;
};

const saveCredentials = (context, key, { accessKeyId, secretAccessKey, sessionToken, expireTime }) =>
  context.store.setItem(
    key,
    JSON.stringify({ accessKeyId, secretAccessKey, sessionToken, expireTime: expireTime.valueOf() }),
  );

// Main run function
const run = async (
  context,
  Username,
  Password,
  UserPoolId,
  ClientId,
  IdentityPoolId,
  CognitoRegion,
  CredentialType,
) => {
  if (!Username) {
    throw new Error('Username attribute is required');
  }
  if (!Password) {
    throw new Error('Password attribute is required');
  }
  if (!UserPoolId) {
    throw new Error('UserPoolId attribute is required');
  }
  if (!ClientId) {
    throw new Error('ClientId attribute is required');
  }
  if (!IdentityPoolId) {
    throw new Error('IdentityPoolId attribute is required');
  }
  if (!CognitoRegion) {
    throw new Error('CognitoRegion attribute is required');
  }
  if (!CredentialType) {
    throw new Error('CredentialType attribute is required');
  }

  const key = [Username, Password, UserPoolId, ClientId, IdentityPoolId, CognitoRegion].join('::');
  const credentials = await loadCredentials(context, key);
  if (credentials) {
    // JWT token is still valid, reuse the credentials
    return credentials[CredentialType];
  }

  // Compute a new token
  try {
    const token = await authenticate({
      Username,
      Password,
      UserPoolId,
      ClientId,
      IdentityPoolId,
    });
    const newCredentials = await getCredentials(token, { UserPoolId, IdentityPoolId, CognitoRegion });
    await saveCredentials(context, key, newCredentials);

    return newCredentials[CredentialType];
  } catch (error) {
    console.error(error.message);
    await saveCredentials(context, key, { error: error.message });
    throw error.message;
  }
};

module.exports.templateTags = [
  {
    name: 'AwsCognitoIdentity',
    displayName: 'AWS Cognito Identity',
    description: 'Plugin for Insomnia to provide Cognito Identity login from AWS',
    args: [
      {
        displayName: 'Username',
        type: 'string',
        validate: (arg) => (arg ? '' : 'Required'),
      },
      {
        displayName: 'Password',
        type: 'string',
        validate: (arg) => (arg ? '' : 'Required'),
      },
      {
        displayName: 'UserPoolId',
        type: 'string',
        validate: (arg) => (arg ? '' : 'Required'),
      },
      {
        displayName: 'ClientId',
        type: 'string',
        validate: (arg) => (arg ? '' : 'Required'),
      },
      {
        displayName: 'IdentityPoolId',
        type: 'string',
        validate: (arg) => (arg ? '' : 'Required'),
      },
      {
        displayName: 'CognitoRegion',
        type: 'string',
        validate: (arg) => (arg ? '' : 'Required'),
      },
      {
        displayName: 'CredentialType',
        type: 'enum',
        defaultValue: 'accessKeyId',
        options: [
          {
            displayName: 'accessKeyId',
            value: 'accessKeyId',
          },
          {
            displayName: 'secretAccessKey',
            value: 'secretAccessKey',
          },
          {
            displayName: 'sessionToken',
            value: 'sessionToken',
          },
        ],
      },
    ],
    run,
  },
];
