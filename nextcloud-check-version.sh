#!/bin/bash
#
# Checks for nextcloud updates.
# Builds the weird url, sends mail if updates are available.
# Based on work from here: https://spielwiese.la-evento.com/xelasblog/archives/75-Mailbenachrichtigung-bei-verfuegbaren-Nextcloud-Updates.html

###
# Full path to version file.
VERSFILE=/var/www/nextcloud/version.php
CONFIGFILE=/var/www/nextcloud/config/config.php
###

TMPFILE=$(mktemp /tmp/nc-updatecheck.XXXXX)
URLBASE='https://updates.nextcloud.org/updater_server/?version='
PHP=$(php -v | grep -v '(c)' | cut -d ' ' -f 2 | sed -e 's/-.*//g' -e 's/\./x/g')

# Original code looked for OC-Channel in version.php. Kummer had to modifiy it
# to look at updater.release.channel in config.php
#RCHAN=$(grep 'OC_Channel ' $VERSFILE | cut -d "'" -f 2)
RCHAN=$(grep 'updater.release.channel' $CONFIGFILE | cut -d "'" -f 4)

VERSION=$(grep 'OC_Version =' $VERSFILE | cut -d '(' -f 2 | cut -d ')' -f 1)
CURRENT=$(echo $VERSION | sed -e 's/,/./g')
VERSIONURL=$(echo $VERSION | sed -e 's/,/x/g')
BUILD_RAW=$(grep OC_Build $VERSFILE | cut -d "'" -f 2)
BUILD_ENC=$(php -r "print urlencode(\"$BUILD_RAW\");";)
URL=${URLBASE}${VERSIONURL}xxx${RCHAN}xx${BUILD_ENC}x${PHP}

curl -s -A 'Nextcloud Updater' $URL > $TMPFILE

if [ -s $TMPFILE ]
then
  NEW=$(grep 'version>' $TMPFILE | sed -e 's/version//g' -e 's/[<>/]//g')
  if [ -n "$NEW" ]
  then
    echo "You are currently running nextcloud version $CURRENT, new version $NEW is available." 
  fi
fi

rm $TMPFILE
exit 0
