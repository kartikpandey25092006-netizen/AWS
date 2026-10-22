function handler(event) {
  var request = event.request;
  var path = request.uri;

  // Only the Storefront's client-side account pages need the S3 app shell.
  // API and asset errors must keep their original status and response body.
  if (path === '/account/orders' || path === '/account/orders/' ||
      path === '/admin/orders' || path === '/admin/orders/') {
    request.uri = '/index.html';
  }

  return request;
}
