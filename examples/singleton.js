const singleton = Symbol();
const singletonEnforcer = Symbol();

const baseAbsPath = __dirname + "/";
const request = require("request");
const sharedLib = require(baseAbsPath + "../lib/shared");

const gen32bytes = function() {
  const s4 = function() {
    return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  };
  return s4() + s4() + s4() + s4() + s4() + s4() + s4() + s4();
};

const getRandomInt = function(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
};

const BackendApiCore = require(baseAbsPath + "../lib/BackendApiCore").default;

class BackendApiSingleton extends BackendApiCore {
  constructor(enforcer) {
    if (enforcer != singletonEnforcer) throw "Cannot construct singleton";
 
    super(enforcer);
  }
 
  static get instance() {
    if (!this[singleton]) {
      this[singleton] = new BackendApiSingleton(singletonEnforcer);
    }
    return this[singleton];
  }
}

const instance = BackendApiSingleton.instance;
instance.loadConfigFileSync(baseAbsPath + "./configs/fserver.conf");

/* Info dict loading. */
const webLoginInfoDict = instance.queryWebLoginInfoDictSync();
console.log(
  "The login info dictionary\n",
  webLoginInfoDict,
  "\n the loaded mch_id and mch_secret",
  instance.mchId,
  instance.mchSecret
);

const miniServerPort = 8888;
const miniServerAsyncNotiPath = "/async-cb/v1/wechat-pubsrv/payment/notify";

/* Mini server for async notification */
const express = require("express");
const app = express();

// Body parser middleware.
const bodyParser = require("body-parser");
app.use(
  bodyParser.urlencoded({
    extended: true
  })
);
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: "*/*" }));

const notificationRouter = express.Router({
  mergeParams: true
});

/**
 * 生成排序后的支付参数 query
 * @param queryObj
 * @returns {Promise.<string>}
 */
const buildQuery = function(queryObj) {
  console.log('------ BuildQuery ---------')
  const sortPayOptions = {};
  for (const key of Object.keys(queryObj).sort()) {
    if(queryObj[key]) sortPayOptions[key] = queryObj[key];
  }
  let payOptionQuery = "";
  for (const key of Object.keys(sortPayOptions).sort()) {
    payOptionQuery += key + "=" + sortPayOptions[key] + "&";
  }
  payOptionQuery = payOptionQuery.substring(0, payOptionQuery.length - 1);
  console.log(payOptionQuery)
  console.log('------ BuildQuery End ---------')
  return payOptionQuery;
};

/**
 * 对 query 进行签名
 * @param queryStr
 * @returns {Promise.<string>}
 */
const signQuery = function(queryStr) {
  console.log('------ signQuery ------')
  console.log(queryStr)
  // queryStr = queryStr + "&key=" + config.partner_key;
  queryStr = queryStr + "&key=" + 'mch_secret';
  console.log(queryStr)
  const md5 = require("md5");
  const md5Sign = md5(queryStr);
  console.log('------ signQuery End ------')
  return md5Sign.toUpperCase();
};

notificationRouter.post(miniServerAsyncNotiPath, function(req, res) {
  instance
    .xmlStr2ObjAsync(req.body)
    .then(function(result) {
      console.log("A payment notification comes in ");
      console.dir(result);
      const signString = signQuery(buildQuery(result.xml));
      console.log(signString)
      return instance.verifyPaymentNotificationAsync(req.body);
    })
    .then(function(trueOrFalse) {
      console.log('------ trueOrFalse ------')
      console.log(trueOrFalse)
      const respStr = instance.generateRespStrSyncForPaymentNotification(
        trueOrFalse
      );
      if (false) {
        console.log(
          "Verification of notification failed, should respond with ",
          respStr
        );
      }
      console.log("generateRespStrSyncForPaymentNotification == ", respStr);
      res.send(respStr);
    })
    .catch(function(err) {
      const respStr = instance.generateRespStrSyncForPaymentNotification(false);
      console.log("Error occurred", err, ", should respond with", respStr);
      res.send(respStr);
    });
});
app.use("/", notificationRouter);

app.listen(miniServerPort, function() {
  console.log("Mini server listening on port " + miniServerPort);

  /* Unified order API of `NATIVE` type. */
  // const outTradeNo = gen32bytes();
  // const notifyUrl =
  //   "http://" + instance.callbackNotifyGateway + miniServerAsyncNotiPath;
  // const nonceStr = gen32bytes();
  // const body = "This is a testing order";
  // const totalFeeCents = getRandomInt(100, 10000);
  // const tradeType = "NATIVE";
  // const openId = null;
  // const limitPay = null;

  const outTradeNo = gen32bytes();
  const notifyUrl =
    "http://" + instance.callbackNotifyGateway + miniServerAsyncNotiPath;
  const nonceStr = gen32bytes();
  const body = "This is a testing order";
  const totalFeeCents = getRandomInt(100, 10000);
  const tradeType = "NATIVE";
  const openId = null;
  const limitPay = null;
  const attach = '12321321321';

  instance 
    .queryUnifiedOrderRespAsync(
      outTradeNo,
      notifyUrl,
      nonceStr,
      body,
      totalFeeCents,
      tradeType,
      attach
    )
    .then(function(respBody) {
      console.log('--------- 1 ------')
      console.log(respBody);
      return instance.xmlStr2ObjAsync(respBody);
    })
    .then(function(result) {
      console.log("Response from payment server is");
      console.dir(result);
      return payUnifiedOrder(result.xml.code_url, "SUCCESS", "11");
    })
    .then(function(paymentRsp) {
      console.log("paymentRsp is");
      console.dir(paymentRsp);
    });
});

const payUnifiedOrder = function(codeUrl, indendedResultCode, intendedErrCode) {
  // console.log({codeUrl, indendedResultCode, intendedErrCode})
  const endpoint =
    instance.apiProtocol +
    "//" +
    instance.apiGateway +
    "/payment/authorization";
  const theUnifiedOrderInfo = sharedLib.getQueryParamsFromURLStr(codeUrl);
  console.log(instance.appId);
  const params = {
    app_id: instance.appId,
    mch_id: instance.mchId,
    out_trade_no: theUnifiedOrderInfo.out_trade_no,
    prepay_id: theUnifiedOrderInfo.prepay_id,
    intended_result_code: indendedResultCode,
    intended_err_code: intendedErrCode, 
    Attach: 'payType=1&goodsType=2'
  };
  return new Promise(function(resolve, reject) {
    request.post(
      {
        url: endpoint,
        form: JSON.stringify(params)
      },
      function(error, wxResp, body) {
        if (undefined !== error && null !== error) {
          console.log("payment fails#1, error is ", error);
          resolve(null);
        } else if (undefined === wxResp || null === wxResp) {
          console.log("payment fails#2, wxResp is ", wxResp);
          resolve(null);
        } else if (200 != wxResp.statusCode) {
          console.log("payment fails#3, wxResp is ", wxResp);
          resolve(null);
        } else {
          resolve(body);
        }
      }
    );
  });
};
