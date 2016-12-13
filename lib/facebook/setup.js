'use strict';

const crypto = require('crypto');
const prompt = require('souffleur');
const rp = require('minimal-request-promise');
const fbReply = require('./reply');
const fbParse = require('./parse');
const validateFbRequestIntegrity = require('./validate-integrity');
const color = require('../console-colors');

module.exports = function fbSetup(api, bot, logError, optionalParser, optionalResponder) {
  let parser = optionalParser || fbParse;
  let responder = optionalResponder || fbReply;

  api.get('/facebook', request => {
    if (request.queryString['hub.verify_token'] === request.env.facebookVerifyToken)
      return request.queryString['hub.challenge'];

    logError(`Facebook can't verify the token. It expected '${request.env.facebookVerifyToken}', but got '${request.queryString['hub.verify_token']}'. Make sure you are using the same token you set in 'facebookVerifyToken' stage env variable.`);
    return 'Error';
  }, {success: {contentType: 'text/plain'}});

  api.post('/facebook', request => {
    // We are doing verification if FB Secret exist in env because we don't want to break old bots that forgot to add it
    if (request.env.facebookAppSecret && !validateFbRequestIntegrity(request))
      return Promise.reject('X-Hub-Signatures does not match');

    let arr = [].concat.apply([], request.body.entry.map(entry => entry.messaging));
    let fbHandle = parsedMessage => {
      if (parsedMessage) {
        var recipient = parsedMessage.sender;
        //console.log('claudia-bot-builder: parsedMessage: ', parsedMessage)
        var p_id = parsedMessage.originalRequest.recipient.id
        console.log('p_id is ', p_id)
        console.log('request Env ', request.env)
        console.log('token is ', request.env[p_id])

        return Promise.resolve(parsedMessage).then(parsedMessage => bot(parsedMessage, request))
          .then(botResponse => responder(recipient, botResponse, request.env[p_id]))
          .catch(logError);
      }
    };

    return Promise.all(arr.map(message => fbHandle(parser(message))))
      .then(() => 'ok');
  });

  const fbAuthTokenPrompt = 'Facebook page access tokens [{pageId: PAGE_ID, pageToken: PAGE_ACCESS_TOKEN}]: '
  api.addPostDeployStep('facebook', (options, lambdaDetails, utils) => {
    return Promise.resolve().then(() => {
      return utils.apiGatewayPromise.getStagePromise({
        restApiId: lambdaDetails.apiId,
        stageName: lambdaDetails.alias
      }).then(data => {
        if (options['configure-fb-bot']) {
          let token, pageAccessToken;

          return Promise.resolve().then(() => {
            if (data.variables && data.variables.facebookVerifyToken)
              return data.variables.facebookVerifyToken;

            return crypto.randomBytes(8);
          })
          .then(rawToken => {
            token = rawToken.toString('base64').replace(/[^A-Za-z0-9]/g, '');
            return utils.apiGatewayPromise.createDeploymentPromise({
              restApiId: lambdaDetails.apiId,
              stageName: lambdaDetails.alias,
              variables: {
                facebookVerifyToken: token
              }
            });
          })
          .then(() => {
            console.log(`\n\n${color.green}Facebook Messenger setup${color.reset}\n`);
            console.log(`\nFollowing info is required for the setup, for more info check the documentation.\n`);
            console.log(`\nYour webhook URL is: ${color.cyan}${lambdaDetails.apiUrl}/facebook${color.reset}\n`);
            console.log(`Your verify token is: ${color.cyan}${token}${color.reset}\n`);


            return prompt([fbAuthTokenPrompt, 'Facebook App Secret']);
          })
          .then(results => {
            console.log('\n');


            //pageAccessToken = results['Facebook page access token'];
            //console.log('pageAccessTokens Unparsed', results[fbAuthTokenPrompt])
            //console.log('pageAccessTokens Stringified', JSON.stringify(results[fbAuthTokenPrompt]))

            let pageAccessTokens = JSON.parse(results[fbAuthTokenPrompt])
            let pageAccessDic = {}
            pageAccessTokens.forEach(_pat => pageAccessDic[_pat.pageId] = _pat.pageToken)
            console.log('pageAccessDic', pageAccessDic)
            let pageAccessDicStringified = JSON.stringify(pageAccessDic)
            let pageId1 = pageAccessTokens[0].pageId
            let pageId2 = pageAccessTokens[1].pageId

            const deployment = {
              restApiId: lambdaDetails.apiId,
              stageName: lambdaDetails.alias,
              variables: {
                facebookAppSecret: results['Facebook App Secret'],
                facebookAccessTokens: pageAccessTokens[0].pageToken,
                pageId1: pageAccessTokens[0].pageToken,
                pageId2: pageAccessTokens[1].pageToken,
              }
            };
            //facebookAccessToken: pageAccessToken,
            pageAccessToken = pageAccessTokens[0].pageToken;
            if (!data.variables || !data.variables.facebookAppSecret)
              console.log(`\n${color.yellow}Deprecation warning:${color.reset} your bot is not using facebook validation. Please re-run with --configure-fb to set the facebook it. This will become mandatory in the next major version. See https://github.com/claudiajs/claudia-bot-builder/blob/master/docs/API.md#message-verification for more information.\n`);

            return utils.apiGatewayPromise.createDeploymentPromise(deployment);
          })
          .then(() => rp.post(`https://graph.facebook.com/v2.6/me/subscribed_apps?access_token=${pageAccessToken}`));
        }
      });
    })
      .then(() => `${lambdaDetails.apiUrl}/facebook`);
  });
};
