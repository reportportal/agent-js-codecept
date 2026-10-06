Feature('RP Plugin tests');

Scenario('Send passed results to RP @pass', (I) => {
    I.amOnPage('/');
    I.dontSee('abc');
});

Scenario('Send failed results to RP @fail', (I) => {
    I.amOnPage('/');
    I.see('abcdef');
});